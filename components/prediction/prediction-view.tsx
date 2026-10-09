"use client";

import { LoadingState } from "@/components/app/loading-state";
import { ArrowLeft, ExternalLink, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { PREDICTION_RANGES, type PredictionBook, type PredictionRange } from "@/lib/prediction/market-data";
import { formatChance, type PredictionEvent, type PredictionMarket } from "@/lib/prediction/types";
import { EventImage, PredictionHome, SOURCE_NAME, SOURCES, SourceBadge, compactUsd, useEventBrowser, type EventBrowser } from "./prediction-home";
import { ProbabilityChart } from "./probability-chart";
import { PredictionTicket } from "./prediction-ticket";
import { usePredictionBook, usePredictionEvent, usePriceHistory } from "./use-prediction";
const panel = "surface-panel min-h-0 overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55";
/** Detail panels scroll on their own on desktop; on phones the detail scrolls as one column instead. */
const detailPanel = "surface-panel rounded-2xl border border-app-card/80 bg-app-card/55 lg:min-h-0 lg:overflow-y-auto";

function endsText(endsAt: number | null) {
  if (endsAt === null) return null;
  const left = endsAt - Date.now();
  if (left < 0) return "Awaiting result";
  if (left < 3_600_000) return `Ends in ${Math.max(1, Math.round(left / 60_000))}m`;
  if (left < 86_400_000) return `Ends in ${Math.round(left / 3_600_000)}h`;
  return `Ends ${new Date(endsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: left > 300 * 86_400_000 ? "numeric" : undefined })}`;
}

/**
 * The headline number of an event row: a single market's Yes chance, the likeliest candidate of a one-winner event,
 * or (independent lines such as price strikes) just how many markets it has.
 */
function leader(event: PredictionEvent): { label: string; chance: number | null } | null {
  const [first] = event.markets;
  if (event.markets.length === 1) return { label: first.outcomes[0].label, chance: first.outcomes[0].price };
  if (!event.exclusive) return null;
  const best = event.markets.reduce((top, market) => ((market.outcomes[0].price ?? 0) > (top.outcomes[0].price ?? 0) ? market : top), first);
  return { label: best.label, chance: best.outcomes[0].price };
}

function EventList({ browser, selected, onSelect }: { browser: EventBrowser; selected: string | null; onSelect: (event: PredictionEvent) => void }) {
  const { source, setSource, category, setCategory, sort, setSort, draft, setDraft, query, data, error, loading, events, categories } = browser;

  return (
    <section aria-label="Markets" className={`${panel} flex h-full flex-col`}>
      <div className="shrink-0 space-y-2 border-b border-app-hairline p-3">
        <div className="flex gap-0.5 rounded-lg bg-app-chip p-0.5">
          {SOURCES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={source === entry.id}
              onClick={() => setSource(entry.id)}
              className={`h-7 flex-1 rounded-md text-[12px] font-semibold ${source === entry.id ? "bg-app-card text-app-ink shadow-xs" : "text-app-muted hover:text-app-ink"}`}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <label className="flex h-9 items-center gap-2 rounded-xl border border-app-field-border bg-app-field px-3 focus-within:border-app-focus">
          <Search className="size-4 text-app-muted" aria-hidden />
          <input value={draft} onChange={(change) => setDraft(change.target.value)} placeholder="Search markets" aria-label="Search markets" className="min-w-0 flex-1 bg-transparent text-[13px] text-app-ink outline-hidden placeholder:text-app-faint" />
        </label>
        <div className="scrollbar-none -mx-3 flex gap-1 overflow-x-auto px-3">
          {categories.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={category === entry.id}
              onClick={() => setCategory(entry.id)}
              className={`h-7 shrink-0 rounded-lg px-2.5 text-[12px] font-medium ${category === entry.id ? "bg-app-selected text-app-ink" : "text-app-muted hover:text-app-ink"}`}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {!query && (
          <div className="flex items-center justify-between text-[11px] text-app-muted">
            <span>{events.length} events</span>
            <button type="button" onClick={() => setSort(sort === "volume" ? "ending" : "volume")} className="font-semibold hover:text-app-ink">
              Sort: {sort === "volume" ? "24h volume" : "Ending soon"}
            </button>
          </div>
        )}
      </div>
      <ul className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto">
        {loading && !data && (
          <li>
            <LoadingState label="Loading markets…" />
          </li>
        )}
        {error && !data && <li className="p-6 text-center text-[13px] text-app-down">{error}</li>}
        {data && events.length === 0 && <li className="p-6 text-center text-[13px] text-app-muted">No markets found.</li>}
        {events.map((event) => {
          const top = leader(event);
          return (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => onSelect(event)}
                aria-current={selected === event.id ? "true" : undefined}
                className={`flex w-full items-center gap-3 border-b border-app-hairline px-3 py-2.5 text-left transition-colors ${selected === event.id ? "bg-app-selected" : "hover:bg-app-selected/50"}`}
              >
                <EventImage event={event} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[13px] font-medium leading-snug text-app-ink">{event.title}</span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <SourceBadge source={event.source} />
                    <span className="truncate text-[11px] text-app-faint">{event.volume24h ? `${compactUsd.format(event.volume24h)} 24h` : endsText(event.endsAt)}</span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {top ? (
                    <>
                      <span className="block text-[15px] font-semibold tabular-nums text-app-ink">{formatChance(top.chance)}</span>
                      {event.markets.length > 1 && <span className="block max-w-[90px] truncate text-[10px] text-app-muted">{top.label}</span>}
                    </>
                  ) : (
                    <span className="block text-[11px] font-medium text-app-muted">{event.markets.length} markets</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {data && data.failed.length > 0 && <p className="shrink-0 border-t border-app-hairline px-3 py-2 text-[11px] text-app-down">Couldn&apos;t load {data.failed.map((name) => SOURCE_NAME[name]).join(", ")} right now.</p>}
    </section>
  );
}

function MarketRows({ event, market, side, onPick }: { event: PredictionEvent; market: PredictionMarket; side: 0 | 1; onPick: (market: PredictionMarket, side: 0 | 1) => void }) {
  const price = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(value < 0.1 || value > 0.9 ? 1 : 0)}¢`);
  return (
    <ul className="divide-y divide-app-hairline">
      {event.markets.map((entry) => {
        const active = entry.id === market.id;
        const change = entry.change24h;
        return (
          <li key={entry.id} className={`flex items-center gap-3 px-4 py-2.5 ${active ? "bg-app-selected/60" : ""}`}>
            <button type="button" onClick={() => onPick(entry, side)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[13px] font-medium text-app-ink">{entry.label}</span>
              {entry.volume24h ? <span className="text-[11px] text-app-faint">{compactUsd.format(entry.volume24h)} 24h</span> : null}
            </button>
            <span className="w-16 text-right">
              <span className="block text-[15px] font-semibold tabular-nums text-app-ink">{formatChance(entry.outcomes[0].price)}</span>
              {change ? <span className={`block text-[10px] tabular-nums ${change > 0 ? "text-app-up" : "text-app-down"}`}>{`${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}`}</span> : null}
            </span>
            {([0, 1] as const).map((index) => (
              <button
                key={index}
                type="button"
                onClick={() => onPick(entry, index)}
                aria-pressed={active && side === index}
                className={`h-9 w-[76px] shrink-0 truncate sm:w-[92px] rounded-lg px-2 text-[12px] font-semibold transition-colors ${
                  index === 0
                    ? active && side === 0
                      ? "bg-app-up text-white"
                      : "bg-app-up/12 text-app-up hover:bg-app-up/20"
                    : active && side === 1
                      ? "bg-app-down text-white"
                      : "bg-app-down/12 text-app-down hover:bg-app-down/20"
                }`}
              >
                {entry.outcomes[index].label.length > 6 ? price(entry.outcomes[index].price) : `${entry.outcomes[index].label} ${price(entry.outcomes[index].price)}`}
              </button>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

function BookView({ book, outcome }: { book: PredictionBook | null; outcome: string }) {
  const rows = 6;
  const asks = (book?.asks ?? []).slice(0, rows).reverse();
  const bids = (book?.bids ?? []).slice(0, rows);
  const max = Math.max(1, ...asks.map((level) => level.size), ...bids.map((level) => level.size));
  const row = (level: { price: number; size: number }, tone: "up" | "down") => (
    <li key={`${tone}${level.price}`} className="relative flex justify-between px-4 py-[3px] text-[12px] tabular-nums">
      <span aria-hidden className={`absolute inset-y-0 right-0 ${tone === "up" ? "bg-app-up/10" : "bg-app-down/10"}`} style={{ width: `${(level.size / max) * 100}%` }} />
      <span className={`relative ${tone === "up" ? "text-app-up" : "text-app-down"}`}>{(level.price * 100).toFixed(level.price * 100 < 10 ? 2 : 1)}¢</span>
      <span className="relative text-app-muted">{level.size.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
    </li>
  );
  const spread = book?.asks[0] && book.bids[0] ? book.asks[0].price - book.bids[0].price : null;
  return (
    <section aria-label="Order book" className="border-t border-app-hairline py-2">
      <h3 className="flex justify-between px-4 pb-1 text-[11px] font-semibold text-app-muted">
        <span>Order book · {outcome}</span>
        <span>Shares</span>
      </h3>
      {!book ? (
        <p className="px-4 py-4 text-center text-[12px] text-app-muted">Loading book…</p>
      ) : (
        <>
          <ul>{asks.map((level) => row(level, "down"))}</ul>
          <p className="px-4 py-1 text-center text-[11px] text-app-faint">{spread === null ? "No spread" : `Spread ${(spread * 100).toFixed(1)}¢`}</p>
          <ul>{bids.map((level) => row(level, "up"))}</ul>
        </>
      )}
    </section>
  );
}

function EventDetail({ id, initial, onBack }: { id: string; initial: { marketId: string | null; side: 0 | 1 }; onBack: () => void }) {
  const { data: event, error } = usePredictionEvent(id);
  const [marketId, setMarketId] = useState<string | null>(initial.marketId);
  const [side, setSide] = useState<0 | 1>(initial.side);
  const [range, setRange] = useState<PredictionRange>("1w");
  useEffect(() => {
    setMarketId(initial.marketId);
    setSide(initial.side);
  }, [id, initial]);
  const market = event?.markets.find((entry) => entry.id === marketId) ?? event?.markets[0] ?? null;
  const history = usePriceHistory(event?.source ?? null, market?.outcomes[0].asset ?? null, range);
  const book = usePredictionBook(event?.source ?? null, market?.outcomes[side].asset ?? null);

  if (!event || !market) {
    return <section className={`${panel} grid h-full place-items-center text-[13px] ${error ? "text-app-down" : "text-app-muted"}`}>{error ?? "Loading market…"}</section>;
  }
  const pick = (next: PredictionMarket, nextSide: 0 | 1) => {
    setMarketId(next.id);
    setSide(nextSide);
  };
  const ends = endsText(event.endsAt);

  return (
    <div className="scrollbar-subtle grid h-full min-h-0 grid-cols-[minmax(0,1fr)] content-start gap-2 max-lg:overflow-y-auto lg:grid-cols-[minmax(0,1fr)_clamp(280px,22vw,340px)] lg:content-stretch">
      <section aria-label={event.title} className={`${detailPanel} scrollbar-subtle flex flex-col`}>
        <header className="flex items-start gap-3 border-b border-app-hairline p-4">
          <button type="button" onClick={onBack} aria-label="Back to all markets" title="All markets" className="-ml-1 mt-1 rounded-lg p-1 text-app-muted hover:text-app-ink">
            <ArrowLeft className="size-4" aria-hidden />
          </button>
          <EventImage event={event} size={48} />
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] font-semibold leading-snug text-app-ink">{event.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-app-muted">
              <SourceBadge source={event.source} />
              {event.subtitle && <span>{event.subtitle}</span>}
              {ends && <span>{ends}</span>}
              {event.volume24h ? <span>{compactUsd.format(event.volume24h)} 24h</span> : null}
              {event.volume ? <span>{compactUsd.format(event.volume)} total</span> : null}
              {event.url && (
                <a href={event.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-app-ink">
                  Rules <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </p>
          </div>
        </header>
        <div className="shrink-0 px-4 pt-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-app-muted">
              <span className="font-semibold text-app-ink">{market.label === event.title ? market.outcomes[0].label : market.label}</span>{" "}
              <span className="text-[20px] font-semibold tabular-nums text-app-ink">{formatChance(market.outcomes[0].price)}</span> chance
            </p>
            <div className="flex gap-0.5 rounded-lg bg-app-chip p-0.5">
              {PREDICTION_RANGES.map((entry) => (
                <button key={entry} type="button" aria-pressed={range === entry} onClick={() => setRange(entry)} className={`h-6 rounded-md px-2 text-[11px] font-semibold uppercase ${range === entry ? "bg-app-card text-app-ink shadow-xs" : "text-app-muted hover:text-app-ink"}`}>
                  {entry}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 h-[220px]">
            {history.data && history.data.points.length > 1 ? (
              <ProbabilityChart points={history.data.points} />
            ) : (
              <p className="grid h-full place-items-center text-[12px] text-app-muted">{history.error ?? (history.loading ? "Loading chart…" : "No trades in this range yet.")}</p>
            )}
          </div>
        </div>
        <div className="mt-2 border-t border-app-hairline">
          <MarketRows event={event} market={market} side={side} onPick={pick} />
        </div>
      </section>
      <aside aria-label="Order" className={`${detailPanel} scrollbar-subtle flex flex-col`}>
        <PredictionTicket event={event} market={market} side={side} onSide={setSide} book={book.data} />
        <BookView book={book.data} outcome={market.outcomes[side].label} />
      </aside>
    </div>
  );
}

/**
 * Prediction markets from Polymarket and Hyperliquid HIP-4. It opens on the overview (`PredictionHome`: categories,
 * event cards, live trades); picking an event shows the list beside its chart, markets, book and buy panel, with a
 * back button to the overview. The selection lives in the URL (`?event=`) so it can be shared.
 */
export function PredictionView() {
  const browser = useEventBrowser();
  const [selected, setSelected] = useState<string | null>(null);
  const [initial, setInitial] = useState<{ marketId: string | null; side: 0 | 1 }>({ marketId: null, side: 0 });
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("event");
    if (fromUrl) setSelected(fromUrl);
  }, []);
  const select = (id: string | null, marketId: string | null = null, side: 0 | 1 = 0) => {
    setSelected(id);
    setInitial({ marketId, side });
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("event", id);
    else url.searchParams.delete("event");
    window.history.replaceState(null, "", url);
  };

  if (!selected) return <PredictionHome browser={browser} onOpen={(event, market, side) => select(event.id, market?.id ?? null, side ?? 0)} onOpenId={(id) => select(id)} />;
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[clamp(280px,24vw,360px)_minmax(0,1fr)]">
      <div className="min-h-0 max-lg:hidden">
        <EventList browser={browser} selected={selected} onSelect={(event) => select(event.id)} />
      </div>
      <div className="min-h-0">
        <EventDetail id={selected} initial={initial} onBack={() => select(null)} />
      </div>
    </div>
  );
}
