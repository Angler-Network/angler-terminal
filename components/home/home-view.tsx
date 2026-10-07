"use client";

import { ArrowRight, ArrowUpRight, Flame, Gift, Search, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
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
import { assetRows, matchesQuery, sortAssetRows, type AssetRow, type AssetSort } from "@/lib/markets/rows";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId } from "@/lib/venues/types";

const NEWS_SITE = "https://news.angler.network";
const MOVER_ROWS = 6;
const SEARCH_ROWS = 12;

const MOVERS: Array<{ sort: AssetSort; title: string; icon: LucideIcon; tone: string }> = [
  { sort: "volume", title: "Most traded", icon: Flame, tone: "text-[#f5c97b]" },
  { sort: "gainers", title: "Gainers", icon: TrendingUp, tone: "text-app-up" },
  { sort: "losers", title: "Losers", icon: TrendingDown, tone: "text-app-down" },
];

const panel = "surface-panel overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55";

function Change({ value }: { value: number | undefined }) {
  if (value === undefined) return <span className="text-app-faint">—</span>;
  return (
    <span className={value >= 0 ? "text-app-up" : "text-app-down"}>
      {value >= 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

/** Featured on the hero: the busiest assets, big and tappable. */
const FEATURED = ["BTC", "ETH", "SOL", "HYPE"];

function AssetTile({ row, onOpen }: { row: AssetRow | undefined; onOpen: (symbol: string) => void }) {
  if (!row) return <span aria-hidden className="h-[104px] animate-pulse rounded-xl border border-app-hairline bg-app-card/40" />;
  const up = (row.change24hPct ?? 0) >= 0;
  return (
    <button
      type="button"
      onClick={() => onOpen(row.symbol)}
      className="group flex flex-col gap-2.5 rounded-xl border border-app-hairline bg-app-card/40 p-3.5 text-left transition-colors hover:border-app-hairline-strong hover:bg-app-card/70"
    >
      <span className="flex items-center gap-2">
        <MarketIcon symbol={row.symbol} kind={row.kind} size={26} />
        <span className="text-[14px] font-semibold text-app-ink">{row.symbol}</span>
        {row.change24hPct !== undefined && (
          <span className={`ml-auto rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${up ? "bg-app-up/12 text-app-up" : "bg-app-down/12 text-app-down"}`}>
            {up ? "+" : ""}
            {row.change24hPct.toFixed(2)}%
          </span>
        )}
      </span>
      <span className="text-[20px] font-semibold tabular-nums tracking-tight text-app-ink">{row.price ? formatPrice(row.price) : "—"}</span>
    </button>
  );
}

function AssetLine({ row, onOpen }: { row: AssetRow; onOpen: (symbol: string) => void }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen(row.symbol)} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] tabular-nums hover:bg-app-chip/40">
        <MarketIcon symbol={row.symbol} kind={row.kind} size={22} />
        <span className="min-w-0 flex-1 truncate font-semibold text-app-ink">{row.symbol}</span>
        <span className="text-app-muted">{row.price ? formatPrice(row.price) : "—"}</span>
        <span className="w-[68px] text-right">
          <Change value={row.change24hPct} />
        </span>
      </button>
    </li>
  );
}

function MoverCard({ title, icon: Icon, tone, rows, loaded, onOpen }: { title: string; icon: LucideIcon; tone: string; rows: AssetRow[]; loaded: boolean; onOpen: (symbol: string) => void }) {
  return (
    <section className={`${panel} flex flex-col`}>
      <h2 className="flex items-center gap-2 px-4 pb-1.5 pt-3.5 text-[13px] font-semibold text-app-ink">
        <Icon className={`size-4 ${tone}`} aria-hidden />
        {title}
      </h2>
      <ul className="pb-2">
        {rows.map((row) => (
          <AssetLine key={row.symbol} row={row} onOpen={onOpen} />
        ))}
        {rows.length === 0 && loaded && <li className="px-4 py-4 text-[12px] text-app-muted">Nothing here today.</li>}
        {rows.length === 0 && !loaded && (
          <li aria-hidden className="flex flex-col gap-2 px-4 py-2">
            {Array.from({ length: MOVER_ROWS }, (_, index) => (
              <span key={index} className="h-6 animate-pulse rounded-md bg-app-chip/50" />
            ))}
          </li>
        )}
      </ul>
    </section>
  );
}

function LatestNews() {
  const t = useT();
  const { items, status } = useNewsFeed({ minImportance: 0 });
  const latest = items.slice(0, 7);

  return (
    <section className={`${panel} flex flex-col`}>
      <header className="flex items-center justify-between px-4 pb-1.5 pt-3.5">
        <h2 className="text-[13px] font-semibold text-app-ink">Latest news</h2>
        {status === "live" && (
          <span className="flex items-center gap-1.5 text-[11px] text-app-faint">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-app-up" />
            Live
          </span>
        )}
      </header>
      <ul className="flex-1">
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
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex flex-col px-4 py-2 hover:bg-app-chip/40">
                  {body}
                </a>
              ) : (
                <div className="flex flex-col px-4 py-2">{body}</div>
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
        className="flex items-center justify-between border-t border-app-hairline px-4 py-3 text-[12px] font-semibold text-app-ink hover:bg-app-chip/40"
      >
        More on Angler News
        <ArrowUpRight className="size-4" aria-hidden />
      </a>
    </section>
  );
}

/** A slim banner for the referral program, sitting between the hero and the markets. */
function ReferralBanner() {
  return (
    <Link
      href="/profile#referrals"
      className="group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-[#f5c97b]/30 bg-[#f5c97b]/[0.07] px-4 py-3 transition-colors hover:bg-[#f5c97b]/[0.12]"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f5c97b]/15 text-[#f5c97b]">
        <Gift className="size-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-app-ink">Bring your crew, keep 10% of their points</span>
        <span className="block text-[12px] text-app-muted">Share your link from your profile. Every trader who joins with it earns you points on every trade, for good.</span>
      </span>
      <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[#f5c97b] px-3 text-[12px] font-semibold text-black">
        Get your link
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

/** The landing page: the majors at a glance, a market search, today's movers, the referral program and news. */
export function HomeView() {
  const router = useRouter();
  const { selectAsset } = useSelectedAsset();
  const { marketsByVenue } = useTrading();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => assetRows(marketsByVenue), [marketsByVenue]);
  const venueIds = useMemo(() => (Object.keys(PERP_VENUE_NAMES) as PerpVenueId[]).filter((id) => rows.some((row) => row.venues[id])), [rows]);
  const bySymbol = useMemo(() => new Map(rows.map((row) => [row.symbol, row])), [rows]);
  // The usual majors, topped up with the busiest assets when a venue doesn't list one of them.
  const featured = useMemo(() => {
    const listed = FEATURED.filter((symbol) => rows.length === 0 || bySymbol.has(symbol));
    const extra = sortAssetRows(rows, "volume").map((row) => row.symbol).filter((symbol) => !listed.includes(symbol));
    return [...listed, ...extra].slice(0, FEATURED.length);
  }, [rows, bySymbol]);
  const movers = useMemo(() => MOVERS.map((mover) => ({ ...mover, rows: sortAssetRows(rows, mover.sort).slice(0, MOVER_ROWS) })), [rows]);
  const results = useMemo(() => (query.trim() ? sortAssetRows(rows.filter((row) => matchesQuery(row, query)), "volume").slice(0, SEARCH_ROWS) : []), [rows, query]);

  const open = (symbol: string) => {
    selectAsset(symbol);
    router.push("/perp");
  };
  const loaded = rows.length > 0;

  return (
    <div className="scrollbar-subtle h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-5 px-4 py-6 lg:px-8 lg:py-10">
        <section className={`${panel} relative p-5 sm:p-7`}>
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_100%_0%,rgba(245,201,123,0.10),transparent_60%)]" />
          <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-end">
            <div className="flex flex-col gap-4">
              <div>
                <h1 className="text-[30px] font-semibold leading-[1.1] tracking-tight text-app-ink sm:text-[38px]">
                  Every perp DEX, one screen.
                </h1>
                <p className="mt-2 max-w-[520px] text-[14px] text-app-muted">
                  Best execution across {venueIds.length > 0 ? venueIds.map((id) => PERP_VENUE_NAMES[id]).join(", ") : "every venue"}, swaps on Solana and
                  Robinhood Chain, and AI-scored news you can trade in two taps.
                </p>
              </div>
              <div className="relative max-w-[560px]">
                <label className="flex h-11 items-center gap-2.5 rounded-xl border border-app-field-border bg-app-field px-3.5">
                  <Search className="size-[18px] text-app-faint" aria-hidden />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && results[0]) open(results[0].symbol);
                      if (event.key === "Escape") setQuery("");
                    }}
                    placeholder="Find a market: BTC, NVDA, GOLD…"
                    aria-label="Find a market"
                    className="min-w-0 flex-1 bg-transparent text-[14px] text-app-ink outline-hidden placeholder:text-app-faint"
                  />
                </label>
                {query.trim() && (
                  <ul className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-[360px] overflow-y-auto rounded-xl border border-app-hairline-strong bg-app-card py-1 shadow-[0_16px_40px_rgba(0,0,0,0.4)]">
                    {results.map((row) => (
                      <AssetLine key={row.symbol} row={row} onOpen={open} />
                    ))}
                    {results.length === 0 && <li className="px-4 py-3 text-[12px] text-app-muted">{loaded ? "No market matches." : "Loading markets…"}</li>}
                  </ul>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {featured.map((symbol) => (
                <AssetTile key={symbol} row={bySymbol.get(symbol)} onOpen={open} />
              ))}
            </div>
          </div>
        </section>

        <nav aria-label="Trade" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {marketNav.map(({ href, label, title, icon: Icon }) => (
            <Link key={href} href={href} className={`${panel} group flex items-start gap-3 p-4 transition-colors hover:border-app-hairline-strong`}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-app-chip text-app-ink">
                <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-[14px] font-semibold text-app-ink">
                  {label}
                  <ArrowRight className="size-3.5 text-app-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
                <span className="mt-0.5 line-clamp-2 block text-[12px] text-app-muted">{title}</span>
              </span>
            </Link>
          ))}
        </nav>

        <ReferralBanner />

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_340px] md:grid-cols-2">
          {movers.map((mover) => (
            <MoverCard key={mover.sort} title={mover.title} icon={mover.icon} tone={mover.tone} rows={mover.rows} loaded={loaded} onOpen={open} />
          ))}
          <LatestNews />
        </div>

        <Link href="/markets" className="mx-auto inline-flex items-center gap-1.5 text-[13px] font-semibold text-app-muted hover:text-app-ink">
          Every market, with funding and spreads
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
