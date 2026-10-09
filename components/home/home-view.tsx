"use client";

import { ArrowRight, ArrowUpRight, Flame, Gift, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { marketNav } from "@/components/app/market-nav";
import { SOCIALS, SocialIcon } from "@/components/app/social-links";
import { useSelectedAsset } from "@/components/terminal/selected-asset";
import { useTrading } from "@/components/terminal/trading-provider";
import { useNewsFeed } from "@/lib/angler/use-news-feed";
import { formatPrice, formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { HomeSearch } from "./home-search";
import { assetRows, sortAssetRows, type AssetRow, type AssetSort } from "@/lib/markets/rows";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId } from "@/lib/venues/types";

const NEWS_SITE = "https://news.angler.network";
const MOVER_ROWS = 6;

const MOVERS: Array<{ sort: AssetSort; title: string; icon: LucideIcon; tone: string }> = [
  { sort: "volume", title: "Most traded", icon: Flame, tone: "text-app-accent" },
  { sort: "gainers", title: "Gainers", icon: TrendingUp, tone: "text-app-up" },
  { sort: "losers", title: "Losers", icon: TrendingDown, tone: "text-app-down" },
];

/** One short line per market view, about what it does rather than which venues it covers (those keep changing). */
const TAGLINES: Record<string, string> = {
  "/perp": "Leverage on every perp DEX",
  "/swap": "Best route for any token",
  "/spot": "Order-book spot trading",
  "/cex": "Centralized exchanges, coming soon",
  "/prediction": "Trade on what happens next",
};

const BAND_PAIRS = 16;

function PairChip({ row }: { row: AssetRow }) {
  const change = row.change24hPct;
  return (
    <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-app-hairline-strong bg-app-card/70 py-1.5 pl-1.5 pr-3.5 text-[14px] font-semibold text-app-ink">
      <MarketIcon symbol={row.symbol} kind={row.kind} size={22} />
      {row.symbol}/USD
      {change !== undefined && <span className={change >= 0 ? "text-app-up" : "text-app-down"}>{`${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</span>}
    </span>
  );
}

/**
 * The busiest pairs drifting behind the hero in two tilted rows, faded toward the headline. Pure CSS transforms (the
 * compositor moves them; no JavaScript per frame), and still for reduced motion.
 */
function PairDrift({ rows }: { rows: AssetRow[] }) {
  const pairs = useMemo(() => sortAssetRows(rows, "volume").slice(0, BAND_PAIRS), [rows]);
  if (pairs.length === 0) return null;
  const half = Math.ceil(pairs.length / 2);
  const lanes = [pairs.slice(0, half), pairs.slice(half)];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden overflow-hidden rounded-2xl [mask-image:linear-gradient(to_right,transparent_30%,black_75%)] sm:block">
      <div className="absolute -right-24 top-1/2 flex w-[150%] -translate-y-1/2 -rotate-6 flex-col gap-3 opacity-40">
        {lanes.map((lane, index) => (
          <div key={index} className={`pair-drift flex w-max gap-3 ${index === 1 ? "pair-drift-reverse" : ""}`}>
            {/* Twice over, so the lane loops seamlessly at -50%. */}
            {[...lane, ...lane].map((row, position) => (
              <PairChip key={`${row.symbol}-${position}`} row={row} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const latest = items.slice(0, 5);

  return (
    <section className={`${panel} flex flex-col lg:h-0 lg:min-h-full`}>
      <header className="flex items-center justify-between px-4 pb-1.5 pt-3.5">
        <h2 className="text-[13px] font-semibold text-app-ink">Latest news</h2>
        {status === "live" && (
          <span className="flex items-center gap-1.5 text-[11px] text-app-faint">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-app-up" />
            Live
          </span>
        )}
      </header>
      <ul className="min-h-0 flex-1 overflow-hidden">
        {latest.map((item) => {
          const body = (
            <>
              <span className="truncate text-[13px] leading-snug text-app-ink" title={item.headline}>{item.headline}</span>
              <span className="mt-1 flex items-center gap-2 text-[11px] text-app-faint">
                {item.symbol && <span className="font-semibold text-app-muted">{item.symbol}</span>}
                {formatRelativeTime(item.minutesAgo, t)}
              </span>
            </>
          );
          return (
            <li key={item.id}>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-col px-4 py-2 hover:bg-app-chip/40">
                  {body}
                </a>
              ) : (
                <div className="flex min-w-0 flex-col px-4 py-2">{body}</div>
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
      className="group flex flex-wrap items-center gap-x-3 gap-y-3 rounded-2xl border border-app-accent/30 bg-app-accent/[0.07] px-4 py-3 transition-colors hover:bg-app-accent/[0.12] sm:gap-x-4"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-app-accent/15 text-app-accent">
        <Gift className="size-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-app-ink">Trade to earn invites, keep 10% of their fees</span>
        <span className="hidden text-[12px] text-app-muted sm:block">Every $10K you trade on perps and spot earns a single-use invite. Each trader you bring in pays you 10% of their Angler fees, for good.</span>
      </span>
      <span className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-app-accent px-3 text-[13px] font-semibold text-app-on-accent sm:h-8 sm:w-auto sm:text-[12px]">
        My invites
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

/** The landing page: a market search across perps, spot and swaps, today's movers, the referral program and news. */
export function HomeView() {
  const router = useRouter();
  const { selectAsset } = useSelectedAsset();
  const { marketsByVenue } = useTrading();

  const rows = useMemo(() => assetRows(marketsByVenue), [marketsByVenue]);
  const venueIds = useMemo(() => (Object.keys(PERP_VENUE_NAMES) as PerpVenueId[]).filter((id) => rows.some((row) => row.venues[id])), [rows]);
  const movers = useMemo(() => MOVERS.map((mover) => ({ ...mover, rows: sortAssetRows(rows, mover.sort).slice(0, MOVER_ROWS) })), [rows]);

  const open = (symbol: string) => {
    selectAsset(symbol);
    router.push("/perp");
  };
  const loaded = rows.length > 0;

  return (
    <div className="scrollbar-subtle h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-5 px-4 py-6 lg:px-8 lg:py-10">
        <section className="surface-panel relative z-10 rounded-2xl border border-app-card/80 bg-app-card/55 p-5 sm:p-7">
          <div aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(60%_80%_at_100%_0%,rgb(var(--app-accent)/0.10),transparent_60%)]" />
          <PairDrift rows={rows} />
          <div className="relative">
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
              <HomeSearch rows={rows} venueIds={venueIds} />
            </div>
          </div>
        </section>

        <nav aria-label="Trade" className="grid grid-cols-2 gap-2 lg:grid-cols-[repeat(auto-fit,minmax(0,1fr))]">
          {marketNav.map(({ href, label, icon: Icon, soon }) => (
            <Link key={href} href={href} className={`${panel} group flex items-center gap-2.5 px-3 py-3 transition-colors hover:border-app-hairline-strong sm:gap-3.5 sm:px-4 sm:py-3.5`}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-app-chip text-app-ink sm:size-11">
                <Icon className="size-[18px] sm:size-[22px]" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 whitespace-nowrap text-[14px] font-semibold text-app-ink sm:text-[16px]">
                  {label}
                  {soon && <span className="rounded bg-app-accent/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-app-accent">Soon</span>}
                  <ArrowRight className="hidden size-4 text-app-faint transition-transform group-hover:translate-x-0.5 sm:block" aria-hidden />
                </span>
                {/* Phones have room for the name only. */}
                <span className="mt-0.5 hidden truncate text-[12px] text-app-muted sm:block">{TAGLINES[href]}</span>
              </span>
            </Link>
          ))}
        </nav>

        <ReferralBanner />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_340px] md:grid-cols-2">
          {movers.map((mover) => (
            <MoverCard key={mover.sort} title={mover.title} icon={mover.icon} tone={mover.tone} rows={mover.rows} loaded={loaded} onOpen={open} />
          ))}
          <LatestNews />
        </div>

        <Link href="/markets" className="mx-auto inline-flex items-center gap-1.5 text-[13px] font-semibold text-app-muted hover:text-app-ink">
          Every market, with funding and spreads
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>

        {SOCIALS.length > 0 && (
          <footer className="flex flex-col items-center gap-3 border-t border-app-hairline pt-6">
            <p className="text-[12px] text-app-faint">Questions, invites and updates</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SOCIALS.map((social) => (
                <a
                  key={social.id}
                  href={social.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-app-hairline bg-app-card/55 px-3.5 text-[13px] font-semibold text-app-muted transition-colors hover:border-app-hairline-strong hover:text-app-ink"
                >
                  <SocialIcon id={social.id} />
                  {social.label}
                </a>
              ))}
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
