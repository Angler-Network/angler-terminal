"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_MIN_TRADE_USD, type PredictionTrade } from "@/lib/prediction/trades";
import { formatChance, PREDICTION_CATEGORIES, type PredictionCategory, type PredictionEvent, type PredictionMarket, type PredictionSource } from "@/lib/prediction/types";
import { usePredictionEvents, usePredictionTrades } from "./use-prediction";

export type SourceFilter = PredictionSource | "all";
export type SortKey = "volume" | "ending";

export const SOURCES: Array<{ id: SourceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "polymarket", label: "Polymarket" },
  { id: "hyperliquid", label: "Hyperliquid" },
];
export const SOURCE_DOMAIN: Record<PredictionSource, string> = { polymarket: "polymarket.com", hyperliquid: "hyperliquid.xyz" };
export const SOURCE_NAME: Record<PredictionSource, string> = { polymarket: "Polymarket", hyperliquid: "Hyperliquid" };
export const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const panel = "surface-panel min-h-0 overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55";

/**
 * The event list's filters (source, search, category, sort), shared by the overview grid and the list beside an open
 * event, so picking "Sports" on the overview keeps the list on sports.
 */
export function useEventBrowser() {
  const [source, setSource] = useState<SourceFilter>("all");
  const [category, setCategory] = useState<PredictionCategory | "all">("all");
  const [sort, setSort] = useState<SortKey>("volume");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(draft.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [draft]);
  const { data, error, loading } = usePredictionEvents(source, query);
  const events = useMemo(() => {
    const list = (data?.events ?? []).filter((event) => category === "all" || event.category === category);
    if (query) return list;
    return [...list].sort((a, b) =>
      sort === "ending" ? (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity) : (b.volume24h ?? -1) - (a.volume24h ?? -1) || (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity),
    );
  }, [data, category, sort, query]);
  const present = useMemo(() => new Set((data?.events ?? []).map((event) => event.category)), [data]);
  const categories = useMemo(() => [{ id: "all" as const, label: "All" }, ...PREDICTION_CATEGORIES.filter((entry) => present.has(entry.id))], [present]);
  return { source, setSource, category, setCategory, sort, setSort, draft, setDraft, query, data, error, loading, events, categories };
}

export type EventBrowser = ReturnType<typeof useEventBrowser>;

export function EventImage({ event, size }: { event: PredictionEvent; size: number }) {
  const [failed, setFailed] = useState(false);
  const src = event.image && !failed ? event.image : `/api/favicon?domain=${SOURCE_DOMAIN[event.source]}`;
  return (
    // Remote images from the sources' CDNs; next/image would need every host configured.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" aria-hidden width={size} height={size} onError={() => setFailed(true)} className="shrink-0 rounded-lg bg-app-chip object-cover" style={{ width: size, height: size }} />
  );
}

export function SourceBadge({ source }: { source: PredictionSource }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-app-faint">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/favicon?domain=${SOURCE_DOMAIN[source]}`} alt="" aria-hidden width={11} height={11} className="size-[11px] rounded-sm" />
      {SOURCE_NAME[source]}
    </span>
  );
}

/** The two lines a card shows: a one-winner event's likeliest candidates, else its first markets (or the one market). */
function cardMarkets(event: PredictionEvent): PredictionMarket[] {
  if (!event.exclusive) return event.markets.slice(0, 2);
  return [...event.markets].sort((a, b) => (b.outcomes[0].price ?? 0) - (a.outcomes[0].price ?? 0)).slice(0, 2);
}

const shortDate = (time: number | null) => (time ? new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null);

function EventCard({ event, onOpen }: { event: PredictionEvent; onOpen: (event: PredictionEvent, market?: PredictionMarket, side?: 0 | 1) => void }) {
  const lines = cardMarkets(event);
  const more = event.markets.length - lines.length;
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-2xl border border-app-hairline bg-app-card/40 p-3.5 transition-colors hover:border-app-hairline-strong">
      <button type="button" onClick={() => onOpen(event)} className="flex min-w-0 items-center gap-3 text-left">
        <EventImage event={event} size={40} />
        <span className="line-clamp-2 text-[14px] font-semibold leading-snug text-app-ink">{event.title}</span>
      </button>
      <ul className="flex flex-col gap-1.5">
        {lines.map((market) => {
          const chance = market.outcomes[0].price;
          const yesNo = market.outcomes[0].label === "Yes";
          const label = market.label === event.title ? market.outcomes[0].label : market.label;
          return (
            <li key={market.id} className="relative flex h-10 items-center gap-2 overflow-hidden rounded-lg bg-app-chip/40 px-3">
              <span aria-hidden className="absolute inset-y-0 left-0 bg-app-accent/10" style={{ width: `${Math.round((chance ?? 0) * 100)}%` }} />
              <button type="button" onClick={() => onOpen(event, market, 0)} className="relative min-w-0 flex-1 truncate text-left text-[13px] font-medium text-app-ink">
                {label}
              </button>
              <span className="relative text-[13px] font-semibold tabular-nums text-app-ink">{formatChance(chance)}</span>
              {yesNo && (
                <span className="relative flex gap-1">
                  <button type="button" onClick={() => onOpen(event, market, 0)} className="h-7 rounded-md bg-app-up/15 px-2 text-[12px] font-semibold text-app-up hover:bg-app-up/25">
                    Yes
                  </button>
                  <button type="button" onClick={() => onOpen(event, market, 1)} className="h-7 rounded-md bg-app-down/15 px-2 text-[12px] font-semibold text-app-down hover:bg-app-down/25">
                    No
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <footer className="mt-auto flex items-center gap-2 text-[11px] text-app-faint">
        <SourceBadge source={event.source} />
        {event.volume24h ? <span>{compactUsd.format(event.volume24h)} 24h</span> : event.volume ? <span>{compactUsd.format(event.volume)} vol.</span> : null}
        {shortDate(event.endsAt) && <span>· {shortDate(event.endsAt)}</span>}
        {more > 0 && (
          <button type="button" onClick={() => onOpen(event)} className="ml-auto font-semibold text-app-muted hover:text-app-ink">
            +{more} more
          </button>
        )}
      </footer>
    </article>
  );
}

const ago = (time: number) => {
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`;
};

const MINIMUMS = [1, 10, 100, 1000];

/** Polymarket's latest trades across every market, refreshed every few seconds, with a minimum size. */
export function TradesFeed() {
  const [min, setMin] = useState(DEFAULT_MIN_TRADE_USD);
  const { data, error } = usePredictionTrades(min);
  // Re-render the "12s ago" labels between polls.
  const [, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow((count) => count + 1), 5_000);
    return () => window.clearInterval(timer);
  }, []);
  const trades = data?.trades ?? [];
  return (
    <section aria-label="Live trades" className={`${panel} flex h-full flex-col`}>
      <header className="flex shrink-0 items-center gap-2 border-b border-app-hairline px-3 py-2.5">
        <span className="text-[13px] font-semibold text-app-ink">Live trades</span>
        <span className={`size-1.5 rounded-full ${data && !error ? "animate-pulse bg-app-up" : error ? "bg-app-down" : "bg-[#f5c97b]"}`} aria-hidden />
        <span className="ml-auto flex gap-0.5 rounded-lg bg-app-chip p-0.5">
          {MINIMUMS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={min === value}
              onClick={() => setMin(value)}
              title={`Trades of at least $${value.toLocaleString("en-US")}`}
              className={`h-6 rounded-md px-1.5 text-[11px] font-semibold ${min === value ? "bg-app-card text-app-ink shadow-xs" : "text-app-muted hover:text-app-ink"}`}
            >
              ${value >= 1000 ? "1k" : value}+
            </button>
          ))}
        </span>
      </header>
      <ul className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto">
        {!data && !error && <li className="p-6 text-center text-[12px] text-app-muted">Connecting…</li>}
        {error && !data && <li className="p-6 text-center text-[12px] text-app-down">{error}</li>}
        {trades.map((trade: PredictionTrade) => (
          <li key={trade.id} className="flex items-center gap-2.5 border-b border-app-hairline px-3 py-2">
            {trade.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={trade.icon} alt="" aria-hidden width={28} height={28} className="size-7 shrink-0 rounded-md bg-app-chip object-cover" />
            ) : (
              <span aria-hidden className="size-7 shrink-0 rounded-md bg-app-chip" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium text-app-ink" title={trade.title}>
                {trade.title}
              </span>
              <span className="block truncate text-[11px] text-app-muted">
                {trade.trader} <span className={trade.side === "buy" ? "text-app-up" : "text-app-down"}>{trade.side === "buy" ? "bought" : "sold"}</span> {trade.outcome} at{" "}
                {(trade.price * 100).toFixed(trade.price < 0.1 ? 1 : 0)}¢
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-[12px] font-semibold tabular-nums text-app-ink">{trade.usd >= 1000 ? compactUsd.format(trade.usd) : `$${trade.usd.toFixed(trade.usd < 10 ? 2 : 0)}`}</span>
              <span className="block text-[10px] tabular-nums text-app-faint">{ago(trade.time)}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="shrink-0 border-t border-app-hairline px-3 py-1.5 text-[10px] text-app-faint">Polymarket, all markets, newest first.</p>
    </section>
  );
}

/**
 * The /prediction landing: a header with source, search and categories, the events as cards (top two lines with Yes/No),
 * and the live trades beside them. A card, line or Yes/No opens the event (with that market and side picked).
 */
export function PredictionHome({ browser, onOpen }: { browser: EventBrowser; onOpen: (event: PredictionEvent, market?: PredictionMarket, side?: 0 | 1) => void }) {
  const { source, setSource, category, setCategory, sort, setSort, draft, setDraft, query, data, error, loading, events, categories } = browser;
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[minmax(0,1fr)_clamp(280px,22vw,340px)]">
      <section aria-label="Prediction markets" className={`${panel} flex flex-col`}>
        <header className="shrink-0 space-y-3 border-b border-app-hairline p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-app-ink">Prediction markets</h1>
              <p className="text-[13px] text-app-muted">Polymarket and Hyperliquid outcome markets: trade on real-world events.</p>
            </div>
            <div className="flex gap-0.5 rounded-lg bg-app-chip p-0.5">
              {SOURCES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={source === entry.id}
                  onClick={() => setSource(entry.id)}
                  className={`h-7 rounded-md px-3 text-[12px] font-semibold ${source === entry.id ? "bg-app-card text-app-ink shadow-xs" : "text-app-muted hover:text-app-ink"}`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-app-field-border bg-app-field px-3 focus-within:border-app-focus sm:max-w-[360px]">
              <Search className="size-4 text-app-muted" aria-hidden />
              <input value={draft} onChange={(change) => setDraft(change.target.value)} placeholder="Search events" aria-label="Search events" className="min-w-0 flex-1 bg-transparent text-[13px] text-app-ink outline-hidden placeholder:text-app-faint" />
            </label>
            {!query && (
              <button type="button" onClick={() => setSort(sort === "volume" ? "ending" : "volume")} className="ml-auto text-[12px] font-semibold text-app-muted hover:text-app-ink">
                Sort: {sort === "volume" ? "24h volume" : "Ending soon"}
              </button>
            )}
          </div>
          <nav aria-label="Categories" className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4">
            {categories.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={category === entry.id}
                onClick={() => setCategory(entry.id)}
                className={`h-8 shrink-0 rounded-lg px-3 text-[13px] font-semibold transition-colors ${category === entry.id ? "bg-app-selected text-app-ink" : "text-app-muted hover:text-app-ink"}`}
              >
                {entry.label}
              </button>
            ))}
          </nav>
        </header>
        <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto p-3">
          {loading && !data && <p className="p-6 text-center text-[13px] text-app-muted">Loading markets…</p>}
          {error && !data && <p className="p-6 text-center text-[13px] text-app-down">{error}</p>}
          {data && events.length === 0 && <p className="p-6 text-center text-[13px] text-app-muted">No markets found.</p>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3">
            {events.map((event) => (
              <EventCard key={event.id} event={event} onOpen={onOpen} />
            ))}
          </div>
          {data && data.failed.length > 0 && <p className="mt-3 text-[11px] text-app-down">Couldn&apos;t load {data.failed.map((name) => SOURCE_NAME[name]).join(", ")} right now.</p>}
        </div>
      </section>
      <div className="min-h-0 max-lg:h-[420px]">
        <TradesFeed />
      </div>
    </div>
  );
}
