"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { groupLevels, mergeVenueBooks, ownSizeByLevel, spreadOf, tickOptions, withTotals, type BookLevel, type MergedLevel } from "@/lib/trading/orderbook";
import { findMarket } from "@/lib/venues/hyperliquid/markets";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId, VenueMarket } from "@/lib/venues/types";
import { useOrderDraft } from "./order-draft";
import { useSelectedAsset } from "./selected-asset";
import { useTrading } from "./trading-provider";
import { useOrderBook } from "./use-order-book";
import { VenueLogo } from "@/components/terminal/venue-logo";
import { SelectField } from "@/components/app/select-field";
import { bookSources, toggleBookSource, MAX_BOOK_SOURCES } from "@/lib/trading/book-sources";
import { splitVenues } from "@/lib/venues/venue-overflow";
import { useAnchoredPopover } from "./anchored-popover";

/** Levels per side; the sides scroll, so more than fit on screen are worth having. */
const LEVELS = 50;

type Tab = "book" | "trades";
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
const VENUE_COLORS: Record<PerpVenueId, string> = { hyperliquid: "#3fc8b0", lighter: "#8b8ff8", lighterRh: "#d6f24a", aster: "#f0b90b", orderly: "#c084fc", extended: "#7dd3fc" };
const VENUE_SHORT: Record<PerpVenueId, string> = { hyperliquid: "HL", lighter: "Lighter", lighterRh: "Lighter RH", aster: "Aster", orderly: "Orderly", extended: "Extended" };

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

function shownKeyOf(markets: VenueMarket[]) {
  return markets.map((entry) => `${entry.venue}:${entry.coin}`).join(",");
}

/**
 * The book's venue menu: "All venues" (every venue listing the asset) or any set of them, each with its color and logo;
 * a row's box adds or removes it, "Only" shows that one alone.
 */
function BookSourcePicker({ listed, shown, onPick }: { listed: PerpVenueId[]; shown: PerpVenueId[]; onPick: (venues: PerpVenueId[]) => void }) {
  const { triggerRef, panelRef, anchor, open, toggle } = useAnchoredPopover<HTMLButtonElement>({ height: 60 + listed.length * 30 });
  const everyOne = shown.length === listed.length;
  const label = shown.length === 1 ? PERP_VENUE_NAMES[shown[0]] : everyOne ? "All venues" : `${shown.length} venues`;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Venues: ${label}`}
        onClick={toggle}
        className={`ml-auto flex h-6 min-w-0 items-center gap-1 rounded-md border pl-1.5 pr-1 text-[11px] text-app-ink ${open ? "border-app-hairline-strong bg-app-field-hover" : "border-app-hairline bg-app-field hover:bg-app-field-hover"}`}
      >
        {shown.length === 1 && <VenueLogo name={PERP_VENUE_NAMES[shown[0]]} size={14} />}
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0 text-app-muted" aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef as React.RefObject<HTMLDivElement>}
            role="dialog"
            aria-label="Order book venues"
            style={anchor ?? undefined}
            className="surface-menu scrollbar-subtle fixed z-50 flex max-h-[min(420px,70vh)] w-56 flex-col overflow-y-auto overscroll-contain rounded-xl border border-app-hairline-strong bg-app-dialog p-1 text-[12px] shadow-lg"
          >
            <button
              type="button"
              onClick={() => onPick(listed)}
              className="flex items-center justify-between rounded-lg px-2 py-1.5 text-left font-semibold text-app-ink hover:bg-app-chip"
            >
              All venues
              {everyOne && <Check className="size-3.5 text-app-accent" aria-hidden />}
            </button>
            <span className="mx-2 my-1 h-px shrink-0 bg-app-hairline" aria-hidden />
            {listed.map((venue) => {
              const on = shown.includes(venue);
              const full = !on && shown.length >= MAX_BOOK_SOURCES;
              return (
                <div key={venue} className="group flex items-center gap-1 rounded-lg hover:bg-app-chip">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={full || (on && shown.length === 1)}
                    title={full ? `Up to ${MAX_BOOK_SOURCES} venues at once` : undefined}
                    onClick={() => onPick(toggleBookSource(shown, venue))}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-app-ink disabled:cursor-default disabled:opacity-50"
                  >
                    <span
                      aria-hidden
                      className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border"
                      style={on ? { background: VENUE_COLORS[venue], borderColor: VENUE_COLORS[venue] } : { borderColor: VENUE_COLORS[venue] }}
                    >
                      {on && <Check className="size-2.5 text-black" strokeWidth={3} />}
                    </span>
                    <VenueLogo name={PERP_VENUE_NAMES[venue]} size={14} />
                    <span className="truncate">{PERP_VENUE_NAMES[venue]}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onPick([venue])}
                    className="mr-1 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-app-muted opacity-0 hover:text-app-ink focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-100"
                  >
                    Only
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

/** The merged book's color key: up to three venues by name, past that two and "+N sources", which lists them all. */
function SourceLegend({ venues }: { venues: PerpVenueId[] }) {
  const { shown, hidden } = splitVenues(venues, 3);
  const { triggerRef, panelRef, anchor, open, toggle } = useAnchoredPopover<HTMLButtonElement>({ height: 40 + venues.length * 26 });
  const swatch = (venue: PerpVenueId) => <span aria-hidden className="size-2 shrink-0 rounded-xs" style={{ background: VENUE_COLORS[venue] }} />;
  return (
    <span className="ml-auto flex min-w-0 items-center gap-2.5 pr-0.5 text-[10px] text-app-muted" title="Bars show each level's size by venue">
      {shown.map((venue) => (
        <span key={venue} className="flex shrink-0 items-center gap-1">
          {swatch(venue)}
          {VENUE_SHORT[venue]}
        </span>
      ))}
      {hidden.length > 0 && (
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          title={hidden.map((venue) => PERP_VENUE_NAMES[venue]).join(", ")}
          onClick={toggle}
          className={`flex shrink-0 items-center gap-1 rounded px-1 font-semibold ${open ? "bg-app-chip text-app-ink" : "hover:text-app-ink"}`}
        >
          <span className="flex -space-x-0.5">{hidden.map((venue) => <span key={venue}>{swatch(venue)}</span>)}</span>+{hidden.length} sources
        </button>
      )}
      {open &&
        createPortal(
          <div
            ref={panelRef as React.RefObject<HTMLDivElement>}
            role="dialog"
            aria-label="Order book sources"
            style={anchor ?? undefined}
            className="surface-menu fixed z-50 flex w-44 flex-col rounded-xl border border-app-hairline-strong bg-app-dialog p-1 text-[12px] shadow-lg"
          >
            <span className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-app-faint">Sources · {venues.length}</span>
            {venues.map((venue) => (
              <span key={venue} className="flex items-center gap-2 px-2 py-1 text-app-ink">
                {swatch(venue)}
                <VenueLogo name={PERP_VENUE_NAMES[venue]} size={14} />
                {PERP_VENUE_NAMES[venue]}
              </span>
            ))}
          </div>,
          document.body,
        )}
    </span>
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
  const { pickPrice, bookVenue } = useOrderDraft();
  // The venues picked in the venue menu; null = the default "All venues" view.
  const [picked, setPicked] = useState<PerpVenueId[] | null>(null);
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
  // Several venues list the asset: show them merged (the first three, or the ones picked), or the one picked.
  const listed = choices.map((entry) => entry.venue);
  const shownVenues = bookSources(listed, picked);
  const shown = shownVenues.flatMap((venue) => choices.find((entry) => entry.venue === venue) ?? []);
  const isAll = shown.length > 1;
  const market: VenueMarket | null = shown[0] ?? null;
  // A venue picked by hand in the order panel: show its book, when it has one here.
  useEffect(() => {
    if (bookVenue) setPicked([bookVenue.venue as PerpVenueId]);
  }, [bookVenue]);
  // One stream per venue shown (MAX_BOOK_SOURCES slots, one per perp venue); the slots past what's shown stay idle.
  const primary = useOrderBook(market);
  const stream2 = useOrderBook(shown[1] ?? null);
  const stream3 = useOrderBook(shown[2] ?? null);
  const stream4 = useOrderBook(shown[3] ?? null);
  const stream5 = useOrderBook(shown[4] ?? null);
  const stream6 = useOrderBook(shown[5] ?? null);
  const { status } = primary;
  const streams = [primary, stream2, stream3, stream4, stream5, stream6];
  const sides = useMemo(
    () => (isAll ? shown.map((entry, index) => ({ venue: entry.venue, book: streams[index].book, trades: streams[index].trades })) : null),
    // The books and trades themselves are the inputs; `shown` and `streams` are new arrays every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAll, shownKeyOf(shown), ...streams.flatMap((stream) => [stream.book, stream.trades])],
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

  const shownKey = shown.map((entry) => entry.venue).join(",");
  // The user's open orders on the venues shown, marked on their levels.
  const mine = useMemo(() => {
    const venues = new Set(shownKey.split(","));
    const orders = (account?.orders ?? []).filter((order) => venues.has(order.venue) && order.symbol === symbol);
    return { bids: ownSizeByLevel(orders, tick, "bids"), asks: ownSizeByLevel(orders, tick, "asks") };
  }, [account?.orders, shownKey, symbol, tick]);

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
          <BookSourcePicker listed={listed} shown={shownVenues} onPick={setPicked} />
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
              <SourceLegend venues={sides.map(({ venue }) => venue)} />
            )}
          </div>
          <div className="grid shrink-0 grid-cols-3 px-2 pb-1 text-[10px] uppercase tracking-[0.06em] text-app-faint">
            <span>Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Total</span>
          </div>
          {book.bids.length === 0 && book.asks.length === 0 ? (
            <p className="p-3 text-[12px] text-app-faint">
              {status === "offline"
                ? "Order book unavailable. Reconnecting…"
                : status === "live"
                  ? // Read fine but empty: a venue with no makers on this market (Extended's testnet often has none).
                    `No resting orders on ${isAll ? "these venues" : (PERP_VENUE_NAMES[market.venue as PerpVenueId] ?? "this venue")} right now.`
                  : "Loading order book…"}
            </p>
          ) : (
            <>
              {sideView !== "bids" && <Levels rows={asks} side="asks" maxTotal={maxTotal} maxSize={maxSize} decimals={decimals} onPick={pickPrice} mine={mine.asks} />}
              <div className="flex shrink-0 items-center justify-between border-y border-app-hairline px-2 py-1 text-[11px] tabular-nums">
                <span className="font-semibold text-app-ink">
                  {spread ? spread.mid.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals + 1 }) : "—"}
                </span>
                {crossed && merged ? (
                  <span
                    className="font-semibold text-[#f5c97b]"
                    title={`The venues trade at different prices: one's best bid is above another's best ask. Each venue's mid vs the middle one: ${merged.offsets
                      .map(({ venue, pct }) => `${PERP_VENUE_NAMES[venue as PerpVenueId] ?? venue} ${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(3)}%`)
                      .join(", ")}. Here each venue's levels stop at the middle price; pick one venue to see its whole book.`}
                  >
                    Venues {merged.apart.toFixed(3)}% apart
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
