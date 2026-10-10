"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/app/toast-provider";
import { trackPerpOrder } from "@/lib/analytics/client";
import { formatPrice } from "@/lib/format";
import { afterSlice, averageFill, nextSliceSize, sliceDue, type ScaleLeg, type TwapJob } from "@/lib/trading/algo-orders";
import { loadTwapJobs, subscribeTwapJobs, updateTwapJob, updateTwapJobs } from "@/lib/trading/twap-store";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { OrderSide, PerpVenue, PerpVenueId, VenueMarket } from "@/lib/venues/types";

/**
 * Scale and TWAP orders (logic in `lib/trading/algo-orders.ts`). Both go through the venues' own `placeOrder`, so every
 * order carries our fee. TWAP slices are sent by one tab per wallet (a Web Lock), every second checking for a due
 * slice; jobs live in localStorage (`twap-store.ts`), so a reload picks them up where they were.
 */

export type TwapInput = Pick<TwapJob, "venue" | "symbol" | "side" | "totalSize" | "szDecimals" | "slices" | "intervalMs" | "randomize" | "reduceOnly" | "leverage" | "isCross">;

export interface ScaleInput {
  market: VenueMarket;
  side: OrderSide;
  legs: ScaleLeg[];
  reduceOnly: boolean;
  leverage: number;
  isCross: boolean;
}

interface AlgoOrdersValue {
  twapJobs: TwapJob[];
  startTwap: (input: TwapInput) => boolean;
  pauseTwap: (id: string) => void;
  resumeTwap: (id: string) => void;
  cancelTwap: (id: string) => void;
  /** Places every leg in turn; resolves with how many the venue took. */
  placeScale: (input: ScaleInput) => Promise<number>;
}

const AlgoOrdersContext = createContext<AlgoOrdersValue | null>(null);

export function useAlgoOrders() {
  const context = useContext(AlgoOrdersContext);
  if (!context) throw new Error("useAlgoOrders must be used within AlgoOrdersProvider");
  return context;
}

const TICK_MS = 1_000;
const MAX_ACTIVE_TWAPS = 5;

function verbFor(side: OrderSide) {
  return side === "buy" ? "Bought" : "Sold";
}

export function AlgoOrdersProvider({
  address,
  venues,
  isVenueReady,
  onSetup,
  errorMessage,
  children,
}: {
  address: `0x${string}` | null;
  venues: Record<PerpVenueId, PerpVenue>;
  isVenueReady: (venue: PerpVenueId) => boolean;
  onSetup: (venue: PerpVenueId) => void;
  errorMessage: (venue: PerpVenueId, error: unknown) => string;
  children: React.ReactNode;
}) {
  const toast = useToast();
  const [twapJobs, setTwapJobs] = useState<TwapJob[]>([]);

  useEffect(() => {
    if (!address) {
      setTwapJobs([]);
      return;
    }
    const read = () => setTwapJobs(loadTwapJobs(address));
    read();
    return subscribeTwapJobs(read);
  }, [address]);

  // The runner reads the latest helpers through a ref, so a re-render never restarts its lock or timer.
  const helpers = useRef({ venues, isVenueReady, errorMessage, toast });
  useEffect(() => {
    helpers.current = { venues, isVenueReady, errorMessage, toast };
  });

  useEffect(() => {
    if (!address) return;
    let stopped = false;
    let release: (() => void) | null = null;
    let timer: number | undefined;
    let inFlight = false;

    const sendSlice = async (job: TwapJob) => {
      const { venues: map, isVenueReady: ready, errorMessage: describe, toast: notify } = helpers.current;
      let fill: { size: number; price: number } | null = null;
      let error: string | undefined;
      try {
        if (!ready(job.venue)) throw new Error(`Finish the ${PERP_VENUE_NAMES[job.venue]} setup to keep this TWAP running.`);
        const market = await map[job.venue].resolveMarket(job.symbol);
        if (!market) throw new Error(`${PERP_VENUE_NAMES[job.venue]} no longer lists ${job.symbol}.`);
        const result = await map[job.venue].placeOrder(address, {
          market,
          side: job.side,
          kind: "market",
          size: nextSliceSize(job),
          reduceOnly: job.reduceOnly,
          leverage: job.leverage,
          isCross: job.isCross,
        });
        fill = result.status === "filled" ? { size: result.filledSize, price: result.avgPx } : { size: 0, price: 0 };
        if (result.status === "filled") trackPerpOrder(result, { venue: job.venue, side: job.side, newsId: null, oneClick: false });
      } catch (caught) {
        error = describe(job.venue, caught);
      }
      let finished: TwapJob | undefined;
      updateTwapJob(address, job.id, (current) => {
        const next = afterSlice(current, fill, Date.now(), Math.random(), error);
        // Paused or canceled from another tab while the slice was out: keep that, with the fill counted.
        const status = current.status === "running" || next.status === "done" || next.status === "failed" ? next.status : current.status;
        finished = status === "done" || status === "failed" ? { ...next, status } : undefined;
        return { ...next, status };
      });
      if (finished?.status === "done") {
        notify({
          tone: "success",
          title: `TWAP done: ${verbFor(finished.side)} ${Number(finished.filledSize.toFixed(finished.szDecimals))} ${finished.symbol}`,
          message: finished.filledSize > 0 ? `Average price ${formatPrice(averageFill(finished))} on ${PERP_VENUE_NAMES[finished.venue]}` : undefined,
        });
      } else if (finished?.status === "failed") {
        notify({ tone: "error", title: `${finished.symbol} TWAP stopped`, message: finished.error });
      }
    };

    const tick = () => {
      if (stopped || inFlight) return;
      const now = Date.now();
      const due = loadTwapJobs(address).find((job) => sliceDue(job, now));
      if (!due) return;
      inFlight = true;
      void sendSlice(due).finally(() => {
        inFlight = false;
      });
    };

    const run = () => {
      timer = window.setInterval(tick, TICK_MS);
      tick();
    };

    // One tab per wallet sends slices; the others queue for the lock and take over when that tab closes.
    if (typeof navigator !== "undefined" && navigator.locks) {
      void navigator.locks.request(`angler:twap:${address.toLowerCase()}`, () => {
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

  const startTwap = useCallback(
    (input: TwapInput) => {
      if (!address) return false;
      if (!isVenueReady(input.venue)) {
        onSetup(input.venue);
        return false;
      }
      if (loadTwapJobs(address).filter((job) => job.status === "running" || job.status === "paused").length >= MAX_ACTIVE_TWAPS) {
        toast({ tone: "error", title: "Too many TWAPs", message: `Up to ${MAX_ACTIVE_TWAPS} run at once. Cancel one first.` });
        return false;
      }
      const now = Date.now();
      const job: TwapJob = {
        ...input,
        id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        createdAt: now,
        nextAt: now,
        done: 0,
        filledSize: 0,
        filledNotional: 0,
        failures: 0,
        status: "running",
      };
      updateTwapJobs(address, (jobs) => [...jobs, job]);
      toast({
        tone: "success",
        title: `TWAP started: ${input.side === "buy" ? "buy" : "sell"} ${input.totalSize} ${input.symbol}`,
        message: `${input.slices} slices over ${Math.round((input.slices * input.intervalMs) / 60_000)} min on ${PERP_VENUE_NAMES[input.venue]}. Keep this tab open.`,
      });
      return true;
    },
    [address, isVenueReady, onSetup, toast],
  );

  const setStatus = useCallback(
    (id: string, from: TwapJob["status"][], status: TwapJob["status"]) => {
      if (!address) return;
      updateTwapJob(address, id, (job) => (from.includes(job.status) ? { ...job, status, nextAt: status === "running" ? Date.now() : job.nextAt } : job));
    },
    [address],
  );
  const pauseTwap = useCallback((id: string) => setStatus(id, ["running"], "paused"), [setStatus]);
  const resumeTwap = useCallback((id: string) => setStatus(id, ["paused"], "running"), [setStatus]);
  const cancelTwap = useCallback((id: string) => setStatus(id, ["running", "paused"], "canceled"), [setStatus]);

  const placeScale = useCallback(
    async ({ market, side, legs, reduceOnly, leverage, isCross }: ScaleInput) => {
      if (!address) return 0;
      if (!isVenueReady(market.venue)) {
        onSetup(market.venue);
        return 0;
      }
      let placed = 0;
      let firstError: string | null = null;
      // One after another: Lighter's nonces and Hyperliquid's leverage update must not race.
      for (const leg of legs) {
        try {
          const result = await venues[market.venue].placeOrder(address, { market, side, kind: "limit", size: leg.size, limitPx: leg.price, reduceOnly, leverage, isCross });
          placed += 1;
          if (result.status === "filled") trackPerpOrder(result, { venue: market.venue, side, newsId: null, oneClick: false });
        } catch (error) {
          firstError ??= errorMessage(market.venue, error);
        }
      }
      const where = PERP_VENUE_NAMES[market.venue];
      if (placed === legs.length) {
        toast({ tone: "success", title: `Placed ${placed} ${market.symbol} orders`, message: `${side === "buy" ? "Buy" : "Sell"} ladder resting on ${where}.` });
      } else {
        toast({
          tone: "error",
          title: placed ? `Placed ${placed} of ${legs.length} orders` : "Scale order rejected",
          message: `${firstError ?? "The venue refused it."}${placed ? " Check Open orders." : ""}`,
        });
      }
      return placed;
    },
    [address, isVenueReady, onSetup, venues, errorMessage, toast],
  );

  const value = useMemo(
    () => ({ twapJobs, startTwap, pauseTwap, resumeTwap, cancelTwap, placeScale }),
    [twapJobs, startTwap, pauseTwap, resumeTwap, cancelTwap, placeScale],
  );
  return <AlgoOrdersContext.Provider value={value}>{children}</AlgoOrdersContext.Provider>;
}
