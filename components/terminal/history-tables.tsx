"use client";

import { useEffect, useMemo, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { usePortfolioHistory } from "@/components/portfolio/use-portfolio-history";
import { formatPrice } from "@/lib/format";
import { fromHlHistoricalOrder, fromLighterOrder, type OrderHistoryRow, type OrderOutcome } from "@/lib/trading/order-history";
import { byTimeDesc, fromHlFill, fromLighterTrade } from "@/lib/trading/portfolio-history";
import { positionHistory } from "@/lib/trading/position-history";
import { splitCoin } from "@/lib/venues/hyperliquid/markets";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId } from "@/lib/venues/types";
import { signed, td, th, VenueBadge } from "./positions-bar";
import { useTrading } from "./trading-provider";
import { useWallet } from "./wallet-provider";

const REFRESH_MS = 60_000;

const outcomeClass: Record<OrderOutcome, string> = {
  filled: "text-app-up",
  partial: "text-[#f5c97b]",
  canceled: "text-app-muted",
  rejected: "text-app-down",
  open: "text-app-ink",
  triggered: "text-app-ink",
};

function useTimeFormat() {
  const { preferences } = usePreferences();
  return useMemo(
    () => new Intl.DateTimeFormat("en-US", { timeZone: preferences.timeZone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }),
    [preferences.timeZone],
  );
}

function useSymbols() {
  const { marketsByVenue } = useTrading();
  return useMemo(
    () => ({
      hl: (coin: string) => splitCoin(coin).symbol,
      lighter: (marketId: number) => marketsByVenue.lighter?.find((market) => market.assetId === marketId)?.symbol ?? null,
    }),
    [marketsByVenue.lighter],
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <p className="flex h-full min-h-16 items-center justify-center px-3 text-center text-[12px] text-app-muted">{children}</p>;
}

function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return <p className="border-t border-app-hairline px-3 py-1.5 text-[11px] text-app-faint">{notes.join(" ")}</p>;
}

/** Finished and recent orders of every perp venue, newest first, refreshed every minute while the tab is open. */
function useOrderHistory() {
  const { address } = useWallet();
  const { perpOrder } = useTrading();
  const symbols = useSymbols();
  const [state, setState] = useState<{ rows: OrderHistoryRow[]; loading: boolean; notes: string[] }>({ rows: [], loading: true, notes: [] });

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const load = async () => {
      const [hl, lighter] = await Promise.allSettled([
        perpOrder.includes("hyperliquid") ? import("@/lib/venues/hyperliquid/history").then((module) => module.hlOrderHistory(address)) : Promise.resolve([]),
        perpOrder.includes("lighter") ? import("@/lib/venues/lighter/history").then((module) => module.lighterOrderHistory(address)) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      const notes: string[] = [];
      if (hl.status === "rejected") notes.push("Hyperliquid's order history didn't load.");
      if (lighter.status === "rejected") notes.push("Lighter's order history didn't load.");
      if (lighter.status === "fulfilled" && lighter.value === null) notes.push("Lighter orders show once this browser has its trading key.");
      // Hyperliquid lists open orders too; they have their own tab.
      const rows = [
        ...(hl.status === "fulfilled" ? hl.value.map((entry) => fromHlHistoricalOrder(entry, symbols.hl)).filter((row) => row.outcome !== "open") : []),
        ...(lighter.status === "fulfilled" && lighter.value ? lighter.value.flatMap((order) => fromLighterOrder(order, symbols.lighter) ?? []) : []),
      ];
      setState({ rows: byTimeDesc(rows), loading: false, notes });
    };
    void load();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [address, perpOrder, symbols]);

  return state;
}

export function OrderHistoryTable() {
  const { rows, loading, notes } = useOrderHistory();
  const time = useTimeFormat();
  if (loading) return <Message>Loading order history…</Message>;
  if (rows.length === 0)
    return (
      <>
        <Message>No past orders yet.</Message>
        <Notes notes={notes} />
      </>
    );
  return (
    <>
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-app-card">
          <tr>
            <th className={th}>Time</th>
            <th className={th}>Asset</th>
            <th className={th}>Type</th>
            <th className={th}>Side</th>
            <th className={th}>Price</th>
            <th className={th}>Filled / size</th>
            <th className={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-app-hairline">
              <td className={`${td} text-app-muted`}>{time.format(row.time)}</td>
              <td className={td}>
                <span className="font-semibold">{row.symbol}</span>
                <VenueBadge venue={row.venue} />
              </td>
              <td className={td}>
                {row.type}
                {row.reduceOnly && <span className="ml-1.5 text-[10px] uppercase text-app-faint">Reduce</span>}
              </td>
              <td className={`${td} ${row.side === "buy" ? "text-app-up" : "text-app-down"}`}>{row.side === "buy" ? "Buy" : "Sell"}</td>
              <td className={td}>
                {row.price !== null ? formatPrice(row.price) : "Market"}
                {row.triggerPrice !== null && <span className="ml-1 text-app-faint">@ {formatPrice(row.triggerPrice)}</span>}
              </td>
              <td className={td}>
                {row.filled} / {row.size}
              </td>
              <td className={`${td} ${outcomeClass[row.outcome]}`}>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Notes notes={notes} />
    </>
  );
}

function duration(from: number | null, to: number) {
  if (from === null) return "—";
  const minutes = Math.max(0, Math.round((to - from) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Positions closed in the last 30 days, rebuilt from fills (`lib/trading/position-history.ts`). */
export function PositionHistoryTable() {
  const history = usePortfolioHistory();
  const { account, lighter } = useTrading();
  const symbols = useSymbols();
  const time = useTimeFormat();
  const closed = useMemo(() => {
    const hlFills = (history.hyperliquid?.fills ?? []).map((fill) => fromHlFill(fill, symbols.hl));
    const lighterIndex = lighter?.accountIndex;
    const lighterFills =
      lighterIndex != null
        ? (history.lighter?.trades ?? []).map((trade) => fromLighterTrade(trade, lighterIndex, (marketId) => symbols.lighter(marketId) ?? `#${marketId}`))
        : [];
    const current = (account?.positions ?? []).map((position) => ({ venue: position.venue as PerpVenueId, symbol: position.symbol, size: position.size }));
    return positionHistory([...hlFills, ...lighterFills], current);
  }, [history, account?.positions, lighter?.accountIndex, symbols]);

  if (history.loading) return <Message>Loading position history…</Message>;
  const notes = [
    ...history.failed.map((venue) => `${PERP_VENUE_NAMES[venue]}'s history didn't load.`),
    ...(history.hyperliquid?.truncated || history.lighter?.truncated ? ["Older trades in the window were cut off by the venue."] : []),
  ];
  if (closed.length === 0)
    return (
      <>
        <Message>No positions closed in the last 30 days.</Message>
        <Notes notes={notes} />
      </>
    );
  return (
    <>
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-app-card">
          <tr>
            <th className={th}>Closed</th>
            <th className={th}>Asset</th>
            <th className={th}>Side</th>
            <th className={th}>Size</th>
            <th className={th}>Entry</th>
            <th className={th}>Exit</th>
            <th className={th}>PnL</th>
            <th className={th}>Fees</th>
            <th className={th}>Held</th>
          </tr>
        </thead>
        <tbody>
          {closed.map((position) => (
            <tr key={position.id} className="border-t border-app-hairline">
              <td className={`${td} text-app-muted`}>{time.format(position.closedAt)}</td>
              <td className={td}>
                <span className="font-semibold">{position.symbol}</span>
                <VenueBadge venue={position.venue} />
              </td>
              <td className={`${td} ${position.side === "long" ? "text-app-up" : "text-app-down"}`}>{position.side === "long" ? "Long" : "Short"}</td>
              <td className={td}>{position.size}</td>
              <td className={td} title={position.entryPrice === null ? "Opened before the 30-day window" : undefined}>
                {position.entryPrice !== null ? formatPrice(position.entryPrice) : "—"}
              </td>
              <td className={td}>{formatPrice(position.exitPrice)}</td>
              <td className={`${td} ${position.pnl === null ? "" : position.pnl >= 0 ? "text-app-up" : "text-app-down"}`}>
                {position.pnl === null ? "—" : signed(position.pnl)}
              </td>
              <td className={`${td} text-app-muted`}>{position.fees === null ? "—" : formatPrice(position.fees)}</td>
              <td className={`${td} text-app-muted`}>{duration(position.openedAt, position.closedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Notes notes={notes} />
    </>
  );
}
