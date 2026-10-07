"use client";

import { ArrowRight, ArrowUpRight, Flame, Search, TrendingDown, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { marketNav } from "@/components/app/market-nav";
import { useSelectedAsset } from "@/components/terminal/selected-asset";
import { useTrading } from "@/components/terminal/trading-provider";
import { useNewsFeed } from "@/lib/angler/use-news-feed";
import { formatPrice, formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { MARKET_CATEGORIES, type MarketCategory } from "@/lib/markets/category";
import { assetRows, matchesQuery, sortAssetRows, type AssetRow, type AssetSort } from "@/lib/markets/rows";
import { PERP_VENUE_NAMES, PERP_VENUE_SHORT } from "@/lib/venues/routing";
import type { PerpVenueId } from "@/lib/venues/types";

const NEWS_SITE = "https://news.angler.network";
const SHOWN_ROWS = 25;

const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

const TABS: Array<{ value: AssetSort; label: string; icon: LucideIcon }> = [
  { value: "volume", label: "Trending", icon: Flame },
  { value: "gainers", label: "Top gainers", icon: TrendingUp },
  { value: "losers", label: "Top losers", icon: TrendingDown },
  { value: "openInterest", label: "Open interest", icon: Wallet },
];

const CATEGORY_LABEL = Object.fromEntries(MARKET_CATEGORIES.map((category) => [category.value, category.label])) as Record<MarketCategory, string>;

/** The referral program, in the cream-and-ink look of the home page's one promo. */
function ReferralCard() {
  return (
    <Link
      href="/profile#referrals"
      className="group relative flex min-h-[176px] flex-col justify-between overflow-hidden rounded-2xl bg-linear-to-br from-[#f3ead3] via-[#ece0c0] to-[#d8c79e] p-6 text-[#18261d] shadow-[0_12px_40px_rgba(0,0,0,0.25)]"
    >
      <svg aria-hidden viewBox="0 0 200 160" className="pointer-events-none absolute -right-6 -top-4 h-[190px] w-[240px] opacity-90 transition-transform duration-500 group-hover:-translate-y-1 group-hover:translate-x-1">
        <path d="M30 120 L190 18 L120 150 L98 104 Z" fill="#fbf6e7" />
        <path d="M98 104 L190 18 L120 150 Z" fill="#e7dbb9" />
        <path d="M30 120 L98 104 L190 18 Z" fill="#fffdf4" />
        <path d="M2 156 Q 40 150 62 128" fill="none" stroke="#18261d" strokeWidth="4" strokeLinecap="round" strokeDasharray="0.1 11" />
      </svg>
      <div className="relative">
        <p className="font-serif text-[34px] leading-[1.05] tracking-tight sm:text-[40px]">
          Invite traders.
          <sup className="ml-1 align-super font-sans text-[10px] font-semibold tracking-[0.12em]">BETA</sup>
          <br />
          <span className="rounded-md bg-[#18261d] px-1.5 text-[#f3ead3]">Earn</span> for life.
        </p>
      </div>
      <p className="relative mt-4 flex items-center gap-2 text-[13px] font-medium text-[#18261d]/80">
        Get 10% of the points of every trader you refer. Forever.
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </p>
    </Link>
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

function VenueBadges({ row, venueIds }: { row: AssetRow; venueIds: PerpVenueId[] }) {
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {venueIds.map(
        (id) =>
          row.venues[id] && (
            <span key={id} title={PERP_VENUE_NAMES[id]} className="rounded-sm bg-app-chip px-1 text-[9px] font-semibold uppercase text-app-muted">
              {PERP_VENUE_SHORT[id]}
            </span>
          ),
      )}
    </span>
  );
}

function LatestNews() {
  const t = useT();
  const { items, status } = useNewsFeed({ minImportance: 0 });
  const latest = items.slice(0, 8);

  return (
    <section className="surface-panel flex flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55">
      <header className="flex items-center justify-between border-b border-app-hairline px-4 py-3">
        <h2 className="text-[14px] font-semibold text-app-ink">Latest</h2>
        <span className="flex items-center gap-1.5 text-[11px] text-app-faint">
          {status === "live" && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-app-up" />}
          Angler News
        </span>
      </header>
      <ul className="divide-y divide-app-hairline">
        {latest.map((item) => {
          const body = (
            <>
              <span className="line-clamp-2 text-[13px] leading-snug text-app-ink">{item.headline}</span>
              <span className="mt-1 flex items-center gap-2 text-[11px] text-app-faint">
                {item.symbol && <span className="font-semibold text-app-muted">{item.symbol}</span>}
                {formatRelativeTime(item.minutesAgo, t)}
              </span>
            </>
          );
          return (
            <li key={item.id}>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex flex-col px-4 py-2.5 hover:bg-app-chip/40">
                  {body}
                </a>
              ) : (
                <div className="flex flex-col px-4 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
        {latest.length === 0 && (
          <li className="px-4 py-6 text-center text-[12px] text-app-muted">{status === "unconfigured" || status === "offline" ? "News is unavailable right now." : "Loading news…"}</li>
        )}
      </ul>
      <a
        href={NEWS_SITE}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-auto flex items-center justify-between border-t border-app-hairline px-4 py-3 text-[12px] font-semibold text-app-ink hover:bg-app-chip/40"
      >
        Read everything on Angler News
        <ArrowUpRight className="size-4" aria-hidden />
      </a>
    </section>
  );
}

/** The landing page: search and discover markets across every venue, the referral program and the latest news. */
export function HomeView() {
  const router = useRouter();
  const { selectAsset } = useSelectedAsset();
  const { marketsByVenue } = useTrading();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<AssetSort>("volume");
  const [category, setCategory] = useState<MarketCategory | "all">("all");

  const rows = useMemo(() => assetRows(marketsByVenue), [marketsByVenue]);
  const venueIds = useMemo(() => (Object.keys(PERP_VENUE_NAMES) as PerpVenueId[]).filter((id) => rows.some((row) => row.venues[id])), [rows]);
  const categories = useMemo(() => MARKET_CATEGORIES.filter((option) => rows.some((row) => row.category === option.value)), [rows]);
  const shown = useMemo(
    () => sortAssetRows(rows.filter((row) => matchesQuery(row, query) && (category === "all" || row.category === category)), tab).slice(0, SHOWN_ROWS),
    [rows, query, category, tab],
  );

  const open = (symbol: string) => {
    selectAsset(symbol);
    router.push("/perp");
  };

  return (
    <div className="scrollbar-subtle h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1320px] flex-col gap-6 px-4 py-6 lg:px-8 lg:py-10">
        <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
          <div className="flex flex-col justify-between gap-5">
            <div>
              <h1 className="font-serif text-[36px] leading-tight tracking-tight text-app-ink sm:text-[44px]">Discover Markets</h1>
              <p className="mt-1 text-[13px] text-app-muted">
                {rows.length > 0 ? `${rows.length} markets` : "Markets"} across {venueIds.length > 0 ? venueIds.map((id) => PERP_VENUE_NAMES[id]).join(", ") : "every venue"}, plus swaps and prediction markets.
              </p>
            </div>
            <label className="flex h-12 items-center gap-3 rounded-2xl border border-app-field-border bg-app-field px-4">
              <Search className="size-5 text-app-faint" aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && shown[0]) open(shown[0].symbol);
                }}
                placeholder="Search any market by name or ticker"
                aria-label="Search markets"
                className="min-w-0 flex-1 bg-transparent text-[14px] text-app-ink outline-hidden placeholder:text-app-faint"
              />
            </label>
            <nav aria-label="Trade" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {marketNav.map(({ href, label, title, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  title={title}
                  className="group flex items-center gap-2.5 rounded-xl border border-app-hairline bg-app-card/55 px-3 py-2.5 transition-colors hover:border-app-hairline-strong hover:bg-app-card"
                >
                  <Icon className="size-4 shrink-0 text-app-muted group-hover:text-app-ink" strokeWidth={1.75} aria-hidden />
                  <span className="truncate text-[13px] font-semibold text-app-ink">{label}</span>
                  <ArrowRight className="ml-auto size-3.5 shrink-0 text-app-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              ))}
            </nav>
          </div>
          <ReferralCard />
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="surface-panel min-w-0 overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55">
            <div className="scrollbar-none flex items-center gap-1 overflow-x-auto border-b border-app-hairline px-3 pt-2">
              {TABS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={tab === value}
                  onClick={() => setTab(value)}
                  className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1.5 text-[13px] font-semibold transition-colors ${
                    tab === value ? "border-app-ink text-app-ink" : "border-transparent text-app-muted hover:text-app-ink"
                  }`}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {label}
                </button>
              ))}
              <Link href="/markets" className="ml-auto inline-flex shrink-0 items-center gap-1 px-2 pb-2.5 pt-1.5 text-[12px] font-semibold text-app-muted hover:text-app-ink">
                All markets
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
            <div role="group" aria-label="Category" className="scrollbar-none flex gap-1.5 overflow-x-auto px-3 py-2.5">
              {[{ value: "all" as const, label: "All" }, ...categories].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={category === option.value}
                  onClick={() => setCategory(option.value)}
                  className={`h-7 shrink-0 rounded-lg border px-2.5 text-[12px] font-semibold transition-colors ${
                    category === option.value ? "border-app-ink/70 text-app-ink" : "border-app-hairline text-app-muted hover:text-app-ink"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <table className="w-full text-[13px] tabular-nums">
              <thead>
                <tr className="border-y border-app-hairline text-[11px] font-medium text-app-faint">
                  <th className="px-4 py-2 text-left font-medium">Name</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">24h change</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">24h volume</th>
                  <th className="hidden px-3 py-2 text-right font-medium md:table-cell">Open interest</th>
                  <th className="hidden px-4 py-2 text-right font-medium md:table-cell">Venues</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.symbol} onClick={() => open(row.symbol)} className="cursor-pointer border-b border-app-hairline last:border-b-0 hover:bg-app-chip/40">
                    <td className="px-4 py-2.5">
                      <button type="button" onClick={(event) => (event.stopPropagation(), open(row.symbol))} className="flex items-center gap-2.5 text-left">
                        <MarketIcon symbol={row.symbol} kind={row.kind} size={28} />
                        <span className="flex flex-col">
                          <span className="font-semibold text-app-ink">{row.symbol}</span>
                          <span className="text-[11px] text-app-faint">{CATEGORY_LABEL[row.category]}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right text-app-ink">{row.price ? formatPrice(row.price) : "—"}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Change value={row.change24hPct} />
                    </td>
                    <td className="hidden px-3 py-2.5 text-right text-app-ink sm:table-cell">{row.volume > 0 ? compactUsd.format(row.volume) : "—"}</td>
                    <td className="hidden px-3 py-2.5 text-right text-app-muted md:table-cell">{row.openInterest > 0 ? compactUsd.format(row.openInterest) : "—"}</td>
                    <td className="hidden px-4 py-2.5 md:table-cell">
                      <VenueBadges row={row} venueIds={venueIds} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="p-8 text-center text-[13px] text-app-muted">{rows.length === 0 ? "Loading markets…" : "No market matches."}</p>}
          </section>
          <LatestNews />
        </div>
      </div>
    </div>
  );
}
