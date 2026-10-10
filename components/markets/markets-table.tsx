"use client";

import { LoadingState } from "@/components/app/loading-state";
import { Info, Layers, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { useSelectedAsset } from "@/components/terminal/selected-asset";
import { NetworkFilter, type NetworkFilterLabels } from "@/components/terminal/network-filter";
import { VENUE_MARKS, VenueLogo } from "@/components/terminal/venue-logo";
import type { NetworkKey, NetworkOption } from "@/components/terminal/market-rows";
import { useTrading } from "@/components/terminal/trading-provider";
import { useFunding } from "@/components/terminal/use-funding";
import { useSpotListings } from "@/components/terminal/use-spot-listings";
import { formatPrice } from "@/lib/format";
import { MARKET_CATEGORIES, type MarketCategory } from "@/lib/markets/category";
import { assetNames, assetRows, matchesQuery, type AssetRow } from "@/lib/markets/rows";
import { FUNDING_VENUES, TRADABLE_FUNDING_VENUES, bestFundingArb, fundingApr, type FundingArb, type FundingVenue } from "@/lib/trading/funding";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId } from "@/lib/venues/types";
import { FundingArbDialog } from "./funding-arb-dialog";

/** The tradable venues listing a row's asset: an arb needs two of them. */
const arbVenues = (row: { venues: Partial<Record<PerpVenueId, unknown>> }) => TRADABLE_FUNDING_VENUES.filter((venue) => Boolean(row.venues[venue as PerpVenueId]));

const VENUE_LABELS: Record<FundingVenue, string> = { hyperliquid: "Hyperliquid", lighter: "Lighter", lighterRh: "Lighter RH", aster: "Aster", orderly: "Orderly", binance: "Binance", bybit: "Bybit" };
/** Under each funding column's logo: the Lighter logos look alike, so every column names its venue. */
const VENUE_SHORT: Record<FundingVenue, string> = { hyperliquid: "HL", lighter: "Lighter", lighterRh: "Lighter RH", aster: "Aster", orderly: "Orderly", binance: "Binance", bybit: "Bybit" };

type SortKey = "volume" | "openInterest" | "change" | "arb" | "symbol" | FundingVenue;

/** Every venue, one venue, or assets listed on more than one venue. */
type VenueFilter = "all" | "multi" | PerpVenueId;

const VENUE_PICKER_LABELS: NetworkFilterLabels = { all: "All venues", search: "Search venues", unit: ["market", "markets"], venueGroup: "Perp venues" };

const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

interface Row extends AssetRow {
  rates: Partial<Record<FundingVenue, number>>;
  arb: FundingArb | null;
}

function Apr({ rate }: { rate: number | undefined }) {
  if (rate === undefined) return <span className="text-app-faint">—</span>;
  const apr = fundingApr(rate);
  return (
    <span className={apr >= 0 ? "text-app-up" : "text-app-down"} title={`${(rate * 100).toFixed(4)}% per 8h`}>
      {apr >= 0 ? "+" : ""}
      {apr.toFixed(2)}%
    </span>
  );
}

function Change({ value }: { value: number | undefined }) {
  if (value === undefined) return <span className="text-app-faint">—</span>;
  return (
    <span className={value >= 0 ? "text-app-up" : "text-app-down"}>
      {value >= 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

/**
 * Every asset the terminal can trade on every perp venue (venues come from the market lists, so a new one shows up
 * without changes here), with mainnet funding and the best funding spread among the venues the terminal trades (long
 * where funding is lowest, short where it's highest).
 */
/** Rows rendered at first and added per scroll: every market at once (hundreds) cost a second of main thread on phones. */
const PAGE_ROWS = 60;
/** How long the table waits for the slowest venue before showing what it has (rows landing later would push it down). */
const SETTLE_MS = 2500;

export function MarketsTable() {
  const router = useRouter();
  const { selectAsset } = useSelectedAsset();
  const { marketsByVenue } = useTrading();
  const funding = useFunding();
  const [query, setQuery] = useState("");
  const [venue, setVenue] = useState<VenueFilter>("all");
  const [sort, setSort] = useState<SortKey>("volume");
  const [category, setCategory] = useState<MarketCategory | "all">("all");
  const [arbRow, setArbRow] = useState<Row | null>(null);
  const [limit, setLimit] = useState(PAGE_ROWS);
  const [waited, setWaited] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, []);
  // Every venue answered (a list, or [] when off or failed): no more rows will land above the ones shown.
  const settled = waited || Object.values(marketsByVenue).every((markets) => markets !== undefined);

  const rows = useMemo<Row[]>(
    () =>
      assetRows(marketsByVenue).map((row) => {
        const rates = funding?.[row.symbol] ?? {};
        // A spread is only actionable when both venues we hedge across list the asset.
        return { ...row, rates, arb: arbVenues(row).length >= 2 ? bestFundingArb(rates, arbVenues(row)) : null };
      }),
    [marketsByVenue, funding],
  );
  const listings = useSpotListings(query.trim().length > 0);
  const names = useMemo(() => assetNames(listings), [listings]);
  const venueIds = useMemo(() => (Object.keys(PERP_VENUE_NAMES) as PerpVenueId[]).filter((id) => rows.some((row) => row.venues[id])), [rows]);

  const shown = useMemo(() => {
    const filtered = rows.filter(
      (row) =>
        matchesQuery(row, query, names) &&
        (venue === "all" || (venue === "multi" ? Object.keys(row.venues).length > 1 : Boolean(row.venues[venue]))) &&
        (category === "all" || row.category === category),
    );
    const value = (row: Row) => {
      if (sort === "volume") return row.volume;
      if (sort === "openInterest") return row.openInterest;
      if (sort === "change") return row.change24hPct ?? -Infinity;
      if (sort === "arb") return row.arb?.apr ?? -Infinity;
      if (sort === "symbol") return 0;
      return row.rates[sort] ?? -Infinity;
    };
    return filtered.sort((a, b) => (sort === "symbol" ? a.symbol.localeCompare(b.symbol) : value(b) - value(a)));
  }, [rows, query, names, venue, sort, category]);
  useEffect(() => setLimit(PAGE_ROWS), [query, venue, sort, category]);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || limit >= shown.length) return;
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && setLimit((current) => current + PAGE_ROWS), { rootMargin: "600px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [limit, shown.length, settled]);
  const counts = useMemo(() => {
    const byCategory: Partial<Record<MarketCategory, number>> = {};
    for (const row of rows) byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
    return byCategory;
  }, [rows]);

  const open = (symbol: string) => {
    selectAsset(symbol);
    router.push("/perp");
  };

  const header = (key: SortKey, label: ReactNode, title?: string) => (
    <th className="px-3 py-2 text-right first:text-left">
      <button
        type="button"
        onClick={() => setSort(key)}
        title={title}
        className={`inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.06em] ${sort === key ? "text-app-ink" : "text-app-faint hover:text-app-ink"}`}
      >
        {label}
        {sort === key && " ↓"}
      </button>
    </th>
  );

  // The venue picker, like the market search's: each venue with its logo and how many markets it lists, busiest first.
  const venueOptions = useMemo<NetworkOption[]>(
    () =>
      venueIds
        .map((id) => {
          const name = PERP_VENUE_NAMES[id];
          const mark = VENUE_MARKS[name];
          return { key: `pv:${id}` as NetworkKey, name, logo: mark ? `/api/favicon?domain=${mark.domain}` : "", group: "venue" as const, count: rows.filter((row) => row.venues[id]).length };
        })
        .sort((a, b) => b.count - a.count),
    [venueIds, rows],
  );
  const multiCount = useMemo(() => rows.filter((row) => Object.keys(row.venues).length > 1).length, [rows]);

  return (
    <section className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-app-hairline px-4 py-3">
        <div>
          <h1 className="text-[16px] font-semibold text-app-ink">Markets</h1>
          <p className="flex items-center gap-1.5 text-[12px] text-app-muted">
            Every perp on every venue, with funding side by side.
            <span
              tabIndex={0}
              aria-label="How funding is shown"
              title="Funding is each venue's 8-hour rate, annualized (APR). Positive means longs pay shorts. The spread longs the lowest-funding venue and shorts the highest among the venues you can trade here."
              className="inline-flex text-app-faint hover:text-app-ink"
            >
              <Info className="size-3.5" aria-hidden />
            </span>
          </p>
        </div>
        <label className="ml-auto flex h-9 items-center gap-2 rounded-xl border border-app-field-border bg-app-field px-3">
          <Search className="size-4 text-app-faint" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search, e.g. BTC"
            aria-label="Search markets"
            className="w-40 bg-transparent text-[13px] text-app-ink outline-hidden placeholder:text-app-faint"
          />
        </label>
      </header>
      <div className="scrollbar-none flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-app-hairline px-4 py-2">
        <div role="group" aria-label="Category" className="flex shrink-0 gap-1.5">
          {[{ value: "all" as const, label: "All" }, ...MARKET_CATEGORIES].map((option) => {
            const count = option.value === "all" ? rows.length : (counts[option.value] ?? 0);
            if (option.value !== "all" && count === 0) return null;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={category === option.value}
                onClick={() => setCategory(option.value)}
                className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-colors ${
                  category === option.value ? "bg-app-ink text-app-card" : "bg-app-chip text-app-muted hover:text-app-ink"
                }`}
              >
                {option.label}
                <span className="tabular-nums opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="sticky right-0 ml-auto flex shrink-0 items-center gap-1.5 bg-app-card pl-3">
          <button
            type="button"
            aria-pressed={venue === "multi"}
            onClick={() => setVenue(venue === "multi" ? "all" : "multi")}
            title="Markets listed on two venues or more (where funding spreads and best-price routing apply)"
            className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-colors ${
              venue === "multi" ? "bg-app-ink text-app-card" : "bg-app-chip text-app-muted hover:text-app-ink"
            }`}
          >
            <Layers className="size-3.5" aria-hidden />
            Multi-venue
            <span className="tabular-nums opacity-60">{multiCount}</span>
          </button>
          {venueOptions.length > 1 && (
            <NetworkFilter
              options={venueOptions}
              value={venue === "all" || venue === "multi" ? null : (`pv:${venue}` as NetworkKey)}
              onChange={(key) => setVenue(key ? (key.slice(3) as PerpVenueId) : "all")}
              labels={VENUE_PICKER_LABELS}
            />
          )}
        </div>
      </div>
      <div className="scrollbar-subtle min-h-0 flex-1 overflow-auto">
        <table className="w-full text-[12px] tabular-nums">
          <thead className="sticky top-0 z-10 bg-app-card">
            {/* A group header over the funding columns, so seven percentages under logos read as one thing. */}
            <tr>
              <th colSpan={5} />
              <th colSpan={FUNDING_VENUES.length} className="border-b border-app-hairline px-3 pb-1 pt-2 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-app-faint">
                Funding · APR
              </th>
              <th colSpan={2} />
            </tr>
            <tr>
              {header("symbol", "Asset")}
              <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-[0.06em] text-app-faint">Price</th>
              {header("change", "24h")}
              {header("volume", "24h volume", "Summed over every venue")}
              {header("openInterest", "Open interest", "Summed over every venue")}
              {FUNDING_VENUES.map((fundingVenue) =>
                header(
                  fundingVenue,
                  <span className="flex flex-col items-center gap-0.5">
                    <VenueLogo name={VENUE_LABELS[fundingVenue]} size={16} />
                    <span className="whitespace-nowrap text-[9px] normal-case tracking-normal">{VENUE_SHORT[fundingVenue]}</span>
                  </span>,
                  `Sort by ${VENUE_LABELS[fundingVenue]} funding`,
                ),
              )}
              {header("arb", "Funding spread", "Long the lowest-funding venue, short the highest, among the venues you can trade here")}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(settled ? shown.slice(0, limit) : []).map((row) => (
              // One line per cell and a fixed height, so rows line up whatever they hold.
              <tr key={row.symbol} className="h-12 whitespace-nowrap border-t border-app-hairline hover:bg-app-chip/40">
                <td className="px-3 py-1.5">
                  {/* The venues listing it are in the tooltip: logos here repeated the column headers. */}
                  <button
                    type="button"
                    onClick={() => open(row.symbol)}
                    title={`Listed on ${venueIds.filter((id) => row.venues[id]).map((id) => PERP_VENUE_NAMES[id]).join(", ")}`}
                    className="inline-flex items-center gap-2 font-semibold text-app-ink hover:underline"
                  >
                    <MarketIcon symbol={row.symbol} kind={row.kind} size={20} />
                    {row.symbol}
                  </button>
                </td>
                <td className="px-3 py-1.5 text-right text-app-ink">{row.price ? formatPrice(row.price) : "—"}</td>
                <td className="px-3 py-1.5 text-right">
                  <Change value={row.change24hPct} />
                </td>
                <td className="px-3 py-1.5 text-right text-app-muted">{row.volume > 0 ? compactUsd.format(row.volume) : "—"}</td>
                <td className="px-3 py-1.5 text-right text-app-muted">{row.openInterest > 0 ? compactUsd.format(row.openInterest) : "—"}</td>
                {FUNDING_VENUES.map((fundingVenue) => (
                  <td key={fundingVenue} className="px-3 py-1.5 text-right">
                    <Apr rate={row.rates[fundingVenue]} />
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right">
                  {row.arb ? (
                    <span className="inline-flex flex-col items-end leading-tight">
                      <span className="font-semibold text-app-ink">{row.arb.apr.toFixed(2)}%</span>
                      <span className="text-[11px] text-app-faint">
                        <span className="text-app-up">Long</span> {VENUE_LABELS[row.arb.longVenue]} · <span className="text-app-down">Short</span>{" "}
                        {VENUE_LABELS[row.arb.shortVenue]}
                      </span>
                    </span>
                  ) : (
                    <span className="text-app-faint">—</span>
                  )}
                </td>
                {/* Trade is the main action; Arb a lighter text button before it, in a fixed slot so Trade lines up. */}
                <td className="px-3 py-1.5 text-right">
                  <span className="inline-flex items-center justify-end gap-1">
                    {row.arb ? (
                      <button
                        type="button"
                        onClick={() => setArbRow(row)}
                        title="Open a long and a short together to collect the funding spread"
                        className="h-7 w-11 rounded-md text-[12px] font-semibold text-app-accent hover:bg-app-accent/10"
                      >
                        Arb
                      </button>
                    ) : (
                      <span aria-hidden className="w-11" />
                    )}
                    <button
                      type="button"
                      onClick={() => open(row.symbol)}
                      className="h-7 rounded-md bg-app-accent px-3 text-[12px] font-semibold text-app-on-accent hover:opacity-90"
                    >
                      Trade
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {settled && limit < shown.length && <div ref={sentinel} aria-hidden className="h-px" />}
        {(!settled || shown.length === 0) &&
          (!settled || rows.length === 0 ? <LoadingState label="Loading markets…" /> : <p className="p-6 text-center text-[12px] text-app-muted">No market matches.</p>)}
      </div>
      {arbRow?.arb && arbRow.venues[arbRow.arb.longVenue as PerpVenueId] && arbRow.venues[arbRow.arb.shortVenue as PerpVenueId] && (
        <FundingArbDialog
          symbol={arbRow.symbol}
          arb={arbRow.arb}
          rates={arbRow.rates}
          venues={arbVenues(arbRow).filter((fundingVenue) => arbRow.rates[fundingVenue] !== undefined)}
          markets={arbRow.venues}
          onClose={() => setArbRow(null)}
        />
      )}
    </section>
  );
}
