"use client";

import { useMemo, useState } from "react";
import { groupLevels, spreadOf, tickOptions, withTotals, type BookLevel } from "@/lib/trading/orderbook";
import { findMarket } from "@/lib/venues/hyperliquid/markets";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId, VenueMarket } from "@/lib/venues/types";
import { useOrderDraft } from "./order-draft";
import { useSelectedAsset } from "./selected-asset";
import { useTrading } from "./trading-provider";
import { useOrderBook } from "./use-order-book";

const LEVELS = 30;

type Tab = "book" | "trades";

function decimalsFor(tick: number) {
  return tick >= 1 ? 0 : Math.min(8, Math.ceil(-Math.log10(tick) - 1e-9));
}

function formatSize(size: number) {
  if (size >= 1000) return size.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return size.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

function Levels({
  rows,
  side,
  maxTotal,
  decimals,
  onPick,
}: {
  rows: Array<BookLevel & { total: number }>;
  side: "bids" | "asks";
  maxTotal: number;
  decimals: number;
  onPick: (price: number) => void;
}) {
  const color = side === "bids" ? "text-app-up" : "text-app-down";
  const bar = side === "bids" ? "bg-app-up/10" : "bg-app-down/10";
  // Asks print best-last so the best prices of both sides meet at the spread.
  const ordered = side === "asks" ? [...rows].reverse() : rows;
  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${side === "asks" ? "justify-end" : "justify-start"}`}>
      {ordered.map((row) => (
        <button
          key={row.price}
          type="button"
          onClick={() => onPick(row.price)}
          title="Use as limit price"
          className="relative grid h-[18px] shrink-0 grid-cols-3 px-2 text-[11px] tabular-nums hover:bg-app-chip"
        >
          <span aria-hidden className={`absolute inset-y-0 right-0 ${bar}`} style={{ width: `${maxTotal ? (row.total / maxTotal) * 100 : 0}%` }} />
          <span className={`relative text-left ${color}`}>{row.price.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</span>
          <span className="relative text-right text-app-ink">{formatSize(row.size)}</span>
          <span className="relative text-right text-app-muted">{formatSize(row.total)}</span>
        </button>
      ))}
    </div>
  );
}

/** Live order book and trade tape of the chart's asset on a perp venue. Clicking a price fills the order panel. */
export function OrderBook() {
  const { symbol } = useSelectedAsset();
  const { marketsByVenue, perpOrder } = useTrading();
  const { pickPrice } = useOrderDraft();
  const [venueId, setVenueId] = useState<PerpVenueId | null>(null);
  const [tab, setTab] = useState<Tab>("book");
  const [tickIndex, setTickIndex] = useState(0);

  const choices = perpOrder.flatMap((venue) => {
    const list = marketsByVenue[venue];
    const market = list ? findMarket(list, symbol) : null;
    return market ? [market] : [];
  });
  const market: VenueMarket | null = choices.find((entry) => entry.venue === venueId) ?? choices[0] ?? null;
  const { book, trades, status } = useOrderBook(market);
  const spread = spreadOf(book);
  const ticks = tickOptions(spread?.mid ?? market?.midPx ?? market?.markPx);
  const tick = ticks[Math.min(tickIndex, ticks.length - 1)] ?? 0;
  const decimals = tick ? decimalsFor(tick) : 2;

  const { bids, asks, maxTotal } = useMemo(() => {
    const groupedBids = withTotals(groupLevels(book.bids, tick, "bids").slice(0, LEVELS));
    const groupedAsks = withTotals(groupLevels(book.asks, tick, "asks").slice(0, LEVELS));
    const max = Math.max(groupedBids.at(-1)?.total ?? 0, groupedAsks.at(-1)?.total ?? 0);
    return { bids: groupedBids, asks: groupedAsks, maxTotal: max };
  }, [book, tick]);

  return (
    <section
      aria-label="Order book"
      className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55"
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-app-hairline px-2 py-1.5">
        {(["book", "trades"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
            className={`h-6 rounded-md px-2 text-[12px] font-semibold ${tab === value ? "bg-app-chip text-app-ink" : "text-app-muted hover:text-app-ink"}`}
          >
            {value === "book" ? "Book" : "Trades"}
          </button>
        ))}
        {choices.length > 1 ? (
          <select
            aria-label="Venue"
            value={market?.venue}
            onChange={(event) => setVenueId(event.target.value as PerpVenueId)}
            className="ml-auto h-6 rounded-md border border-app-hairline bg-app-field px-1 text-[11px] text-app-ink"
          >
            {choices.map((entry) => (
              <option key={entry.venue} value={entry.venue}>
                {PERP_VENUE_NAMES[entry.venue]}
              </option>
            ))}
          </select>
        ) : (
          market && <span className="ml-auto text-[11px] text-app-faint">{PERP_VENUE_NAMES[market.venue]}</span>
        )}
        {tab === "book" && ticks.length > 0 && (
          <select
            aria-label="Grouping"
            value={tickIndex}
            onChange={(event) => setTickIndex(Number(event.target.value))}
            className="h-6 rounded-md border border-app-hairline bg-app-field px-1 text-[11px] tabular-nums text-app-ink"
          >
            {ticks.map((value, index) => (
              <option key={value} value={index}>
                {value}
              </option>
            ))}
          </select>
        )}
      </header>

      {!market ? (
        <p className="p-3 text-[12px] text-app-faint">No perp venue lists {symbol}.</p>
      ) : tab === "book" ? (
        <div className="flex min-h-0 flex-1 flex-col py-1">
          <div className="grid shrink-0 grid-cols-3 px-2 pb-1 text-[10px] uppercase tracking-[0.06em] text-app-faint">
            <span>Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Total</span>
          </div>
          {book.bids.length === 0 && book.asks.length === 0 ? (
            <p className="p-3 text-[12px] text-app-faint">{status === "offline" ? "Order book unavailable. Reconnecting…" : "Loading order book…"}</p>
          ) : (
            <>
              <Levels rows={asks} side="asks" maxTotal={maxTotal} decimals={decimals} onPick={pickPrice} />
              <div className="flex shrink-0 items-center justify-between border-y border-app-hairline px-2 py-1 text-[11px] tabular-nums">
                <span className="font-semibold text-app-ink">
                  {spread ? spread.mid.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals + 1 }) : "—"}
                </span>
                <span className="text-app-faint">Spread {spread ? `${spread.pct.toFixed(3)}%` : "—"}</span>
              </div>
              <Levels rows={bids} side="bids" maxTotal={maxTotal} decimals={decimals} onPick={pickPrice} />
            </>
          )}
        </div>
      ) : (
        <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto py-1">
          <div className="grid grid-cols-3 px-2 pb-1 text-[10px] uppercase tracking-[0.06em] text-app-faint">
            <span>Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Time</span>
          </div>
          {trades.length === 0 && <p className="p-3 text-[12px] text-app-faint">Waiting for trades…</p>}
          {trades.map((trade) => (
            <button
              key={trade.id}
              type="button"
              onClick={() => pickPrice(trade.price)}
              className="grid h-[18px] w-full grid-cols-3 px-2 text-[11px] tabular-nums hover:bg-app-chip"
            >
              <span className={`text-left ${trade.side === "buy" ? "text-app-up" : "text-app-down"}`}>{trade.price.toLocaleString("en-US", { maximumFractionDigits: 8 })}</span>
              <span className="text-right text-app-ink">{formatSize(trade.size)}</span>
              <span className="text-right text-app-muted">{new Date(trade.time).toLocaleTimeString("en-GB", { hour12: false })}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
