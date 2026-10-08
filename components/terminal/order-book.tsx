"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { groupLevels, mergeVenueBooks, ownSizeByLevel, spreadOf, tickOptions, withTotals, type BookLevel, type MergedLevel } from "@/lib/trading/orderbook";
import { findMarket } from "@/lib/venues/hyperliquid/markets";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId, VenueMarket } from "@/lib/venues/types";
import { useOrderDraft } from "./order-draft";
import { useSelectedAsset } from "./selected-asset";
import { useTrading } from "./trading-provider";
import { useOrderBook } from "./use-order-book";
import { SelectField } from "@/components/app/select-field";

/** Levels per side; the sides scroll, so more than fit on screen are worth having. */
const LEVELS = 50;

type Tab = "book" | "trades";
type VenueView = PerpVenueId | "all";
/** Both sides of the book, or only the bids (buyers) or only the asks (sellers). */
type SideView = "both" | "bids" | "asks";

const SIDE_VIEWS: Array<{ value: SideView; label: string }> = [
  { value: "both", label: "Bids and asks" },
  { value: "bids", label: "Bids only" },
  { value: "asks", label: "Asks only" },
];

/** A tiny book: asks (red) over bids (green), or one side filling it. */
function SideGlyph({ view }: { view: SideView }) {
  const rows = view === "both" ? ["down", "down", "up", "up"] : view === "bids" ? ["up", "up", "up", "up"] : ["down", "down", "down", "down"];
  return (
    <svg viewBox="0 0 14 12" width="14" height="12" aria-hidden className="shrink-0">
      {rows.map((tone, index) => (
        <rect key={index} x="0" y={index * 3} width="14" height="2" rx="0.5" className={tone === "up" ? "fill-app-up" : "fill-app-down"} />
      ))}
    </svg>
  );
}

/** Venue colors in the merged book: depth segments, legend and trade dots. */
const VENUE_COLORS: Record<PerpVenueId, string> = { hyperliquid: "#3fc8b0", lighter: "#8b8ff8", lighterRh: "#d6f24a", aster: "#f0b90b" };
const VENUE_SHORT: Record<PerpVenueId, string> = { hyperliquid: "HL", lighter: "Lighter", lighterRh: "Lighter RH", aster: "Aster" };

function decimalsFor(tick: number) {
  return tick >= 1 ? 0 : Math.min(8, Math.ceil(-Math.log10(tick) - 1e-9));
}

function formatSize(size: number) {
  if (size >= 1000) return size.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return size.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

type Row = BookLevel & { total: number; byVenue?: MergedLevel["byVenue"] };

function Levels({
  rows,
  side,
  maxTotal,
  maxSize,
  decimals,
  onPick,
  mine,
}: {
  rows: Row[];
  side: "bids" | "asks";
  maxTotal: number;
  /** Merged view: bars show each level's size split by venue instead of the running total. */
  maxSize?: number;
  decimals: number;
  onPick: (price: number) => void;
  /** The user's resting order size per level on this side. */
  mine?: Map<number, number>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Asks stay scrolled to the spread (their bottom) until the user scrolls away from it.
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (side === "asks" && element && pinned.current) element.scrollTop = element.scrollHeight;
  });
  const color = side === "bids" ? "text-app-up" : "text-app-down";
  const bar = side === "bids" ? "bg-app-up/10" : "bg-app-down/10";
  // Asks print best-last so the best prices of both sides meet at the spread.
  const ordered = side === "asks" ? [...rows].reverse() : rows;
  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const element = event.currentTarget;
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 4;
      }}
      className="scrollbar-subtle flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      {/* Short books sit against the spread: asks at the bottom of their half, bids at the top. */}
      {side === "asks" && <div className="flex-1" aria-hidden />}
      {ordered.map((row) => {
        const own = mine?.get(row.price);
        return (
        <button
          key={row.price}
          type="button"
          onClick={() => onPick(row.price)}
          title={`${
            row.byVenue
              ? `${Object.entries(row.byVenue).map(([venue, size]) => `${VENUE_SHORT[venue as PerpVenueId]} ${formatSize(size)}`).join(" · ")} · use as limit price`
              : "Use as limit price"
          }${own ? ` · your orders: ${formatSize(own)}` : ""}`}
          className={`relative grid h-[18px] shrink-0 grid-cols-3 px-2 text-[11px] tabular-nums hover:bg-app-chip ${own ? "bg-app-accent/10" : ""}`}
        >
          {own && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-app-accent" />}
          {row.byVenue && maxSize ? (
            <span aria-hidden className="absolute inset-y-[3px] right-0 flex flex-row-reverse opacity-30" style={{ width: `${(row.size / maxSize) * 100}%` }}>
              {Object.entries(row.byVenue).map(([venue, size]) => (
                <span key={venue} style={{ width: `${(size / row.size) * 100}%`, background: VENUE_COLORS[venue as PerpVenueId] }} />
              ))}
            </span>
          ) : (
            <span aria-hidden className={`absolute inset-y-0 right-0 ${bar}`} style={{ width: `${maxTotal ? (row.total / maxTotal) * 100 : 0}%` }} />
          )}
          <span className={`relative text-left ${color}`}>{row.price.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</span>
          <span className="relative text-right text-app-ink">
            {own && <span className="mr-1 rounded bg-app-accent/20 px-1 text-[10px] font-semibold text-app-accent">{formatSize(own)}</span>}
            {formatSize(row.size)}
          </span>
          <span className="relative text-right text-app-muted">{formatSize(row.total)}</span>
        </button>
        );
      })}
    </div>
  );
}

/**
 * Live order book and trade tape of the chart's asset on a perp venue. Clicking a price fills the order panel.
 * `markets` replaces the perp markets (the Spot view's Hyperliquid or Lighter spot market); `emptyText` says what's
 * missing when there is none.
 */
export function OrderBook({ markets, emptyText }: { markets?: VenueMarket[] | null; emptyText?: string } = {}) {
  const { symbol } = useSelectedAsset();
  const { marketsByVenue, perpOrder, account } = useTrading();
  const { pickPrice } = useOrderDraft();
  const [view, setView] = useState<VenueView | null>(null);
  const [tab, setTab] = useState<Tab>("book");
  const [sideView, setSideView] = useState<SideView>("both");
  const [tickIndex, setTickIndex] = useState(0);

  const choices =
    markets !== undefined
      ? (markets ?? [])
      : perpOrder.flatMap((venue) => {
          const list = marketsByVenue[venue];
          const market = list ? findMarket(list, symbol) : null;
          return market ? [market] : [];
        });
  // Until a venue's market list arrives, the book shows a placeholder rather than "not listed".
  const isLoading = markets !== undefined ? markets === null : choices.length === 0 && perpOrder.some((venue) => marketsByVenue[venue] === undefined);
  // Several venues list the asset: show them merged unless the user picked one.
  const isAll = (view ?? "all") === "all" && choices.length > 1;
  const market: VenueMarket | null = isAll ? choices[0] : (choices.find((entry) => entry.venue === view) ?? choices[0] ?? null);
  // The merged view streams up to two more venues; single views leave them idle.
  const other = isAll ? choices[1] : null;
  const third = isAll ? (choices[2] ?? null) : null;
  const primary = useOrderBook(market);
  const secondary = useOrderBook(other);
  const tertiary = useOrderBook(third);
  const { status } = primary;
  const sides = useMemo(
    () =>
      isAll && market && other
        ? [
            { venue: market.venue, book: primary.book, trades: primary.trades },
            { venue: other.venue, book: secondary.book, trades: secondary.trades },
            ...(third ? [{ venue: third.venue, book: tertiary.book, trades: tertiary.trades }] : []),
          ]
        : null,
    [isAll, market, other, third, primary.book, primary.trades, secondary.book, secondary.trades, tertiary.book, tertiary.trades],
  );
  const merged = useMemo(() => (sides ? mergeVenueBooks(sides, 0) : null), [sides]);
  const book = merged ?? primary.book;
  const trades = useMemo(
    () =>
      sides
        ? sides
            .flatMap((side) => side.trades.map((trade) => ({ ...trade, venue: side.venue as PerpVenueId | undefined })))
            .sort((a, b) => b.time - a.time)
            .slice(0, 60)
        : primary.trades.map((trade) => ({ ...trade, venue: undefined as PerpVenueId | undefined })),
    [sides, primary.trades],
  );
  const spread = spreadOf(book);
  const ticks = tickOptions(spread?.mid ?? market?.midPx ?? market?.markPx);
  const tick = ticks[Math.min(tickIndex, ticks.length - 1)] ?? 0;
  const decimals = tick ? decimalsFor(tick) : 2;

  // The user's open orders on the venues shown, marked on their levels.
  const mine = useMemo(() => {
    const venues = new Set([market?.venue, other?.venue, third?.venue].filter(Boolean));
    const orders = (account?.orders ?? []).filter((order) => venues.has(order.venue) && order.symbol === symbol);
    return { bids: ownSizeByLevel(orders, tick, "bids"), asks: ownSizeByLevel(orders, tick, "asks") };
  }, [account?.orders, market?.venue, other?.venue, third?.venue, symbol, tick]);

  const { bids, asks, maxTotal, maxSize, crossed } = useMemo(() => {
    if (sides) {
      const grouped = mergeVenueBooks(sides, tick);
      const groupedBids = withTotals(grouped.bids.slice(0, LEVELS)).map((row, index) => ({ ...row, byVenue: grouped.bids[index].byVenue }));
      const groupedAsks = withTotals(grouped.asks.slice(0, LEVELS)).map((row, index) => ({ ...row, byVenue: grouped.asks[index].byVenue }));
      const largest = Math.max(0, ...groupedBids.map((row) => row.size), ...groupedAsks.map((row) => row.size));
      return { bids: groupedBids, asks: groupedAsks, maxTotal: 0, maxSize: largest, crossed: grouped.crossed };
    }
    const groupedBids = withTotals(groupLevels(primary.book.bids, tick, "bids").slice(0, LEVELS));
    const groupedAsks = withTotals(groupLevels(primary.book.asks, tick, "asks").slice(0, LEVELS));
    const max = Math.max(groupedBids.at(-1)?.total ?? 0, groupedAsks.at(-1)?.total ?? 0);
    return { bids: groupedBids, asks: groupedAsks, maxTotal: max, maxSize: undefined, crossed: false };
  }, [sides, primary.book, tick]);

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
          <SelectField<VenueView>
            size="xs"
            rootClassName="ml-auto"
            label="Venue"
            value={isAll ? "all" : (market?.venue ?? "all")}
            onChange={setView}
            options={[{ value: "all", label: "All venues" }, ...choices.map((entry) => ({ value: entry.venue, label: PERP_VENUE_NAMES[entry.venue] }))]}
          />
        ) : (
          market && <span className="ml-auto text-[11px] text-app-faint">{PERP_VENUE_NAMES[market.venue]}</span>
        )}
        {tab === "book" && ticks.length > 0 && (
          <SelectField
            size="xs"
            label="Grouping"
            value={String(tickIndex)}
            onChange={(index) => setTickIndex(Number(index))}
            options={ticks.map((value, index) => ({ value: String(index), label: String(value) }))}
          />
        )}
      </header>

      {!market ? (
        isLoading ? (
          <div role="status" aria-label="Loading order book" className="flex flex-1 flex-col gap-1 p-3">
            {Array.from({ length: 12 }, (_, index) => (
              <span key={index} aria-hidden className="h-3.5 shrink-0 animate-pulse rounded-sm bg-app-chip/50" />
            ))}
          </div>
        ) : (
          <p className="p-3 text-[12px] text-app-faint">{emptyText ?? `No perp venue lists ${symbol}.`}</p>
        )
      ) : tab === "book" ? (
        <div className="flex min-h-0 flex-1 flex-col py-1">
          <div role="group" aria-label="Book sides" className="flex shrink-0 items-center gap-0.5 px-1.5 pb-1">
            {SIDE_VIEWS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={sideView === option.value}
                aria-label={option.label}
                title={option.label}
                onClick={() => setSideView(option.value)}
                className={`flex size-6 items-center justify-center rounded-md transition-opacity ${sideView === option.value ? "bg-app-chip opacity-100" : "opacity-45 hover:opacity-80"}`}
              >
                <SideGlyph view={option.value} />
              </button>
            ))}
            {sides && (
              <span className="ml-auto flex items-center gap-2.5 pr-0.5 text-[10px] text-app-muted" title="Bars show each level's size by venue">
                {sides.map(({ venue }) => (
                  <span key={venue} className="flex items-center gap-1">
                    <span className="size-2 rounded-xs" style={{ background: VENUE_COLORS[venue] }} />
                    {VENUE_SHORT[venue]}
                  </span>
                ))}
              </span>
            )}
          </div>
          <div className="grid shrink-0 grid-cols-3 px-2 pb-1 text-[10px] uppercase tracking-[0.06em] text-app-faint">
            <span>Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Total</span>
          </div>
          {book.bids.length === 0 && book.asks.length === 0 ? (
            <p className="p-3 text-[12px] text-app-faint">{status === "offline" ? "Order book unavailable. Reconnecting…" : "Loading order book…"}</p>
          ) : (
            <>
              {sideView !== "bids" && <Levels rows={asks} side="asks" maxTotal={maxTotal} maxSize={maxSize} decimals={decimals} onPick={pickPrice} mine={mine.asks} />}
              <div className="flex shrink-0 items-center justify-between border-y border-app-hairline px-2 py-1 text-[11px] tabular-nums">
                <span className="font-semibold text-app-ink">
                  {spread ? spread.mid.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals + 1 }) : "—"}
                </span>
                {crossed ? (
                  <span className="font-semibold text-[#f5c97b]" title="One venue's best bid is above the other's best ask">
                    Crossed {spread ? `${Math.abs(spread.pct).toFixed(3)}%` : ""}
                  </span>
                ) : (
                  <span className="text-app-faint">Spread {spread ? `${spread.pct.toFixed(3)}%` : "—"}</span>
                )}
              </div>
              {sideView !== "asks" && <Levels rows={bids} side="bids" maxTotal={maxTotal} maxSize={maxSize} decimals={decimals} onPick={pickPrice} mine={mine.bids} />}
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
              key={`${trade.venue ?? ""}${trade.id}`}
              type="button"
              onClick={() => pickPrice(trade.price)}
              className="grid h-[18px] w-full grid-cols-3 px-2 text-[11px] tabular-nums hover:bg-app-chip"
            >
              <span className={`flex items-center gap-1 text-left ${trade.side === "buy" ? "text-app-up" : "text-app-down"}`}>
                {trade.venue && <span role="img" aria-label={VENUE_SHORT[trade.venue]} className="size-1.5 shrink-0 rounded-full" style={{ background: VENUE_COLORS[trade.venue] }} />}
                {trade.price.toLocaleString("en-US", { maximumFractionDigits: 8 })}
              </span>
              <span className="text-right text-app-ink">{formatSize(trade.size)}</span>
              <span className="text-right text-app-muted">{new Date(trade.time).toLocaleTimeString("en-GB", { hour12: false })}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
