"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/app/toast-provider";
import { useTrading } from "@/components/terminal/trading-provider";
import { minOrderUsd, quoteVenues } from "@/components/terminal/use-best-execution";
import { trackPerpOrder } from "@/lib/analytics/client";
import { coinSymbol, leaderEvents, type LeaderEvent, type LeaderPosition } from "@/lib/copy/events";
import { addLog, bookKey, loadBook, loadFollows, recordFill } from "@/lib/copy/follow-store";
import { FOLLOW_SOURCE_NAMES, followName, type Follow } from "@/lib/copy/follows";
import { loadLeader } from "@/lib/copy/leader-client";
import { copyPlan, type CopyStep } from "@/lib/copy/sizing";
import { findMarket } from "@/lib/venues/hyperliquid/markets";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId, VenueMarket } from "@/lib/venues/types";

/**
 * Copies followed wallets while a tab is open: one tab per wallet (Web Lock `angler:copy:<address>`) reads each copying
 * leader every few seconds and turns what changed into market orders through the trading provider, so every copy
 * carries our fee. The first look at a leader only records: positions it already held are never copied.
 */

const POLL_MS = 5_000;
const VERBS: Record<LeaderEvent["kind"], string> = { open: "opened", add: "added to", reduce: "reduced", close: "closed", flip: "flipped" };

const floorTo = (value: number, decimals: number) => Math.floor(value * 10 ** decimals + 1e-9) / 10 ** decimals;

export function CopyRunner({ address }: { address: `0x${string}` }) {
  const trading = useTrading();
  const toast = useToast();
  const latest = useRef({ trading, toast });
  useEffect(() => {
    latest.current = { trading, toast };
  });

  useEffect(() => {
    let stopped = false;
    let release: (() => void) | null = null;
    let timer: number | undefined;
    let busy = false;
    const snapshots = new Map<string, Record<string, LeaderPosition>>();
    const warned = new Set<string>();

    const log = (follow: Follow, tone: "success" | "error" | "info", text: string) => addLog(address, { followId: follow.id, tone, text: `${followName(follow)}: ${text}` });

    /** The market a step trades on: where the copy already lives, else the follower's target venue. */
    const marketFor = async (follow: Follow, event: LeaderEvent, step: CopyStep): Promise<VenueMarket | null> => {
      const { marketsByVenue, perpOrder, isVenueReady } = latest.current.trading;
      const held = loadBook(address)[bookKey(follow.id, event.coin)];
      if (held) {
        const list = marketsByVenue[held.venue as PerpVenueId];
        return list ? findMarket(list, held.coin) : null;
      }
      const sourceList = marketsByVenue[follow.source];
      const symbol = (sourceList && findMarket(sourceList, event.coin)?.symbol) || coinSymbol(event.coin);
      const pick = (venue: PerpVenueId) => {
        const list = marketsByVenue[venue];
        if (!list) return null;
        return venue === follow.source ? findMarket(list, event.coin) : findMarket(list, symbol);
      };
      const target = follow.copy.target;
      if (target !== "best") return pick(target === "same" ? follow.source : target);
      const markets = perpOrder.filter(isVenueReady).flatMap((venue) => pick(venue) ?? []);
      if (markets.length < 2) return markets[0] ?? null;
      const usd = step.usd ?? (step.size ?? 0) * event.price;
      const quotes = await quoteVenues(markets, step.side, usd).catch(() => []);
      return markets.find((market) => market.venue === quotes[0]?.venue) ?? markets[0];
    };

    const runStep = async (follow: Follow, event: LeaderEvent, step: CopyStep) => {
      const { placeOrder, isVenueReady, accounts } = latest.current.trading;
      const market = await marketFor(follow, event, step);
      const symbol = coinSymbol(event.coin);
      if (!market) return log(follow, "error", `${symbol} isn't listed on the copy venue, skipped.`);
      const venueName = PERP_VENUE_NAMES[market.venue];
      if (!isVenueReady(market.venue)) {
        if (!warned.has(market.venue)) {
          warned.add(market.venue);
          latest.current.toast({ tone: "error", title: `Copy paused on ${venueName}`, message: `Set up ${venueName} trading so copies can go through.` });
        }
        return log(follow, "error", `set up ${venueName} trading to copy ${symbol}.`);
      }
      const price = market.midPx ?? market.markPx ?? event.price;
      let size = step.size ?? (step.usd ?? 0) / price;
      if (step.action === "reduce") {
        const open = accounts[market.venue]?.positions.find((position) => position.coin === market.coin);
        const openSize = open && (step.side === "sell" ? open.size > 0 : open.size < 0) ? Math.abs(open.size) : 0;
        if (!openSize) {
          // Closed by hand already: forget the copy so later events don't chase it.
          recordFill(address, follow.id, event.coin, market.venue, market.coin, -(loadBook(address)[bookKey(follow.id, event.coin)]?.size ?? 0));
          return log(follow, "info", `your ${symbol} copy was already closed.`);
        }
        size = Math.min(size, openSize);
      }
      size = floorTo(size, market.szDecimals);
      if (!(size > 0)) return log(follow, "info", `${symbol} change too small to copy.`);
      if (step.action === "open" && size * price < minOrderUsd(market)) {
        return log(follow, "info", `${symbol} copy of $${(size * price).toFixed(2)} is under ${venueName}'s minimum, skipped.`);
      }
      const result = await placeOrder({
        market,
        side: step.side,
        kind: "market",
        size,
        reduceOnly: step.action === "reduce",
        leverage: Math.min(follow.copy.leverage, market.maxLeverage),
        isCross: !market.onlyIsolated,
      });
      if (!result) return log(follow, "error", `${symbol} copy order failed on ${venueName}.`);
      if (result.status !== "filled") return log(follow, "info", `${symbol} copy order is resting on ${venueName}.`);
      recordFill(address, follow.id, event.coin, market.venue, market.coin, step.side === "buy" ? result.filledSize : -result.filledSize);
      trackPerpOrder(result, { venue: market.venue, side: step.side, newsId: null, oneClick: false });
      log(follow, "success", `${step.side === "buy" ? "bought" : "sold"} ${result.filledSize} ${symbol} on ${venueName} (${VERBS[event.kind]} by the wallet).`);
    };

    const tick = async () => {
      if (stopped || busy) return;
      busy = true;
      try {
        const follows = loadFollows(address).filter((follow) => follow.copy.enabled);
        for (const id of snapshots.keys()) if (!follows.some((follow) => follow.id === id)) snapshots.delete(id);
        for (const follow of follows) {
          if (stopped) return;
          const snapshot = await loadLeader(follow.source, follow.address).catch(() => null);
          if (!snapshot) continue;
          const previous = snapshots.get(follow.id);
          snapshots.set(follow.id, snapshot.positions);
          // First look: record only. What the wallet already holds is never copied.
          if (!previous) continue;
          for (const event of leaderEvents(previous, snapshot.positions)) {
            const held = loadBook(address)[bookKey(follow.id, event.coin)]?.size ?? 0;
            const plan = copyPlan(event, follow.copy, held);
            if (plan.steps.length === 0) {
              log(follow, "info", `${VERBS[event.kind]} ${coinSymbol(event.coin)} on ${FOLLOW_SOURCE_NAMES[follow.source]}: not copied (${plan.note ?? "nothing to do"}).`);
              continue;
            }
            for (const step of plan.steps) await runStep(follow, event, step);
          }
        }
      } finally {
        busy = false;
      }
    };

    const run = () => {
      timer = window.setInterval(() => void tick(), POLL_MS);
      void tick();
    };

    if (typeof navigator !== "undefined" && navigator.locks) {
      void navigator.locks.request(`angler:copy:${address.toLowerCase()}`, () => {
        if (stopped) return;
        run();
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      });
    } else {
      run();
    }

    return () => {
      stopped = true;
      window.clearInterval(timer);
      release?.();
    };
  }, [address]);

  return null;
}
