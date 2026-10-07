"use client";

import { Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { OrdersTable, PositionsTable, VenueBadge } from "@/components/terminal/positions-bar";
import { useTrading } from "@/components/terminal/trading-provider";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { useWallet } from "@/components/terminal/wallet-provider";
import { formatPrice } from "@/lib/format";
import {
  byTimeDesc,
  dailyPnl,
  fillTotals,
  fromHlFill,
  fromHlFunding,
  fromLighterTrade,
  rebase,
  windowPnl,
  type FundingPayment,
  type HistoryFill,
  type PnlPoint,
} from "@/lib/trading/portfolio-history";
import { summarizeVenue, totalSummary, type VenueSummary } from "@/lib/trading/portfolio";
import { splitCoin } from "@/lib/venues/hyperliquid/markets";
import { holdingsValue } from "@/lib/venues/jupiter/holdings";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId } from "@/lib/venues/types";
import { HISTORY_DAYS, usePortfolioHistory } from "./use-portfolio-history";
import { useSpotHoldings } from "./use-spot-holdings";
import { SpotTable, STABLECOINS } from "./spot-table";

type Range = 7 | 30;
type HistoryTab = "trades" | "funding";
type Mode = "all" | "perp" | "spot";

const DAY_MS = 86_400_000;
const ROWS_STEP = 50;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const card = "rounded-2xl border border-app-hairline bg-app-card/60";
const th = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-app-faint whitespace-nowrap";
const td = "px-3 py-2 tabular-nums whitespace-nowrap text-app-ink";

function signedUsd(value: number) {
  return `${value >= 0 ? "+" : "-"}${usd.format(Math.abs(value))}`;
}

/** Headline figures: exact below $100K, compact above so they fit their tile on a phone. */
function headline(value: number, sign = false) {
  const text = Math.abs(value) >= 100_000 ? compactUsd.format(Math.abs(value)) : usd.format(Math.abs(value));
  return `${value < 0 ? "-" : sign ? "+" : ""}${text}`;
}

function tone(value: number) {
  return value > 0 ? "text-app-up" : value < 0 ? "text-app-down" : "text-app-ink";
}

function Stat({ label, value, sub, className = "text-app-ink" }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className={`${card} min-w-0 px-4 py-3`}>
      <p className="truncate text-[11px] font-medium uppercase tracking-[0.06em] text-app-faint">{label}</p>
      <p title={value} className={`mt-1 truncate text-[18px] font-semibold tabular-nums sm:text-[22px] ${className}`}>
        {value}
      </p>
      {sub && <p className="truncate text-[12px] tabular-nums text-app-muted">{sub}</p>}
    </div>
  );
}

/** Cumulative PnL as an area chart, green above zero and red below. */
function PnlChart({ points }: { points: PnlPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="py-12 text-center text-[13px] text-app-muted">Not enough history yet.</p>;
  const width = 1000;
  const height = 220;
  const values = points.map((point) => point.pnl);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const x = (index: number) => (index / (points.length - 1)) * width;
  const y = (value: number) => height - ((value - min) / span) * height;
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.pnl).toFixed(1)}`).join(" ");
  const zero = y(0);
  const area = `${line} L${width},${zero} L0,${zero} Z`;
  const shown = hover === null ? points.at(-1)! : points[hover];
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-[12px] text-app-muted">
        <span>{hover === null ? "Today" : shortDate.format(shown.time)}</span>
        <span className={`text-[14px] font-semibold tabular-nums ${tone(shown.pnl)}`}>{signedUsd(shown.pnl)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-56 w-full overflow-visible" onMouseLeave={() => setHover(null)} role="img" aria-label="Cumulative PnL">
        <defs>
          <clipPath id="pnl-above">
            <rect x="0" y="0" width={width} height={zero} />
          </clipPath>
          <clipPath id="pnl-below">
            <rect x="0" y={zero} width={width} height={height - zero} />
          </clipPath>
        </defs>
        <line x1="0" x2={width} y1={zero} y2={zero} className="stroke-app-hairline-strong" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <path d={area} clipPath="url(#pnl-above)" className="fill-app-up/15" />
        <path d={area} clipPath="url(#pnl-below)" className="fill-app-down/15" />
        <path d={line} clipPath="url(#pnl-above)" fill="none" className="stroke-app-up" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d={line} clipPath="url(#pnl-below)" fill="none" className="stroke-app-down" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={height} className="stroke-app-faint" vectorEffect="non-scaling-stroke" />}
        {points.map((point, index) => (
          <rect
            key={point.time}
            x={x(index) - width / (points.length - 1) / 2}
            y="0"
            width={width / (points.length - 1)}
            height={height}
            fill="transparent"
            onMouseEnter={() => setHover(index)}
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-app-faint">
        <span>{shortDate.format(points[0].time)}</span>
        <span>{shortDate.format(points.at(-1)!.time)}</span>
      </div>
    </div>
  );
}

function VenueCards({ rows, pnlByVenue, totalEquity }: { rows: VenueSummary[]; pnlByVenue: Partial<Record<PerpVenueId, number>>; totalEquity: number }) {
  if (rows.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => {
        const share = totalEquity > 0 ? (row.accountValue / totalEquity) * 100 : 0;
        const pnl = pnlByVenue[row.venue];
        return (
          <div key={row.venue} className={`${card} p-4`}>
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-app-ink">{PERP_VENUE_NAMES[row.venue]}</h3>
              <span className="text-[12px] tabular-nums text-app-muted">{share.toFixed(1)}% of equity</span>
            </div>
            <p className="mt-1 text-[20px] font-semibold tabular-nums text-app-ink">{usd.format(row.accountValue)}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-app-chip">
              <div className="h-full rounded-full bg-app-accent" style={{ width: `${share}%` }} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
              <dt className="text-app-muted">Unrealized PnL</dt>
              <dd className={`text-right tabular-nums ${tone(row.unrealizedPnl)}`}>{signedUsd(row.unrealizedPnl)}</dd>
              <dt className="text-app-muted">PnL in range</dt>
              <dd className={`text-right tabular-nums ${tone(pnl ?? 0)}`}>{pnl === undefined ? "—" : signedUsd(pnl)}</dd>
              <dt className="text-app-muted">Margin used</dt>
              <dd className="text-right tabular-nums text-app-ink">{usd.format(row.marginUsed)}</dd>
              <dt className="text-app-muted">Withdrawable</dt>
              <dd className="text-right tabular-nums text-app-ink">{usd.format(row.withdrawable)}</dd>
              <dt className="text-app-muted">Positions · orders</dt>
              <dd className="text-right tabular-nums text-app-ink">
                {row.positions} · {row.orders}
              </dd>
            </dl>
          </div>
        );
      })}
    </div>
  );
}

function TradesTable({ fills }: { fills: HistoryFill[] }) {
  const [limit, setLimit] = useState(ROWS_STEP);
  if (fills.length === 0) return <p className="px-3 py-8 text-center text-[13px] text-app-muted">No trades in this range.</p>;
  return (
    <>
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-app-card">
          <tr>
            <th className={th}>Time</th>
            <th className={th}>Asset</th>
            <th className={th}>Side</th>
            <th className={`${th} text-right`}>Size</th>
            <th className={`${th} text-right`}>Price</th>
            <th className={`${th} text-right`}>Value</th>
            <th className={`${th} text-right`}>Fee</th>
            <th className={`${th} text-right`}>Realized PnL</th>
          </tr>
        </thead>
        <tbody>
          {fills.slice(0, limit).map((fill) => (
            <tr key={fill.id} className="border-t border-app-hairline">
              <td className={`${td} text-app-muted`}>{dateTime.format(fill.time)}</td>
              <td className={td}>
                <span className="font-semibold">{fill.symbol}</span>
                <VenueBadge venue={fill.venue} />
              </td>
              <td className={`${td} ${fill.side === "buy" ? "text-app-up" : "text-app-down"}`}>{fill.direction ?? (fill.side === "buy" ? "Buy" : "Sell")}</td>
              <td className={`${td} text-right`}>{fill.size}</td>
              <td className={`${td} text-right`}>{formatPrice(fill.price)}</td>
              <td className={`${td} text-right`}>{usd.format(fill.usd)}</td>
              <td className={`${td} text-right text-app-muted`}>{fill.fee === null ? "—" : usd.format(fill.fee)}</td>
              <td className={`${td} text-right ${tone(fill.realizedPnl ?? 0)}`}>{fill.realizedPnl === null ? "—" : signedUsd(fill.realizedPnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {fills.length > limit && (
        <button type="button" onClick={() => setLimit((value) => value + ROWS_STEP)} className="w-full border-t border-app-hairline py-2 text-[12px] font-semibold text-app-muted hover:text-app-ink">
          Show more ({fills.length - limit} left)
        </button>
      )}
    </>
  );
}

function FundingTable({ payments }: { payments: FundingPayment[] }) {
  const [limit, setLimit] = useState(ROWS_STEP);
  if (payments.length === 0) return <p className="px-3 py-8 text-center text-[13px] text-app-muted">No funding payments in this range.</p>;
  return (
    <>
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-app-card">
          <tr>
            <th className={th}>Time</th>
            <th className={th}>Asset</th>
            <th className={`${th} text-right`}>Rate</th>
            <th className={`${th} text-right`}>Payment</th>
          </tr>
        </thead>
        <tbody>
          {payments.slice(0, limit).map((payment) => (
            <tr key={`${payment.venue}:${payment.symbol}:${payment.time}`} className="border-t border-app-hairline">
              <td className={`${td} text-app-muted`}>{dateTime.format(payment.time)}</td>
              <td className={td}>
                <span className="font-semibold">{payment.symbol}</span>
                <VenueBadge venue={payment.venue} />
              </td>
              <td className={`${td} text-right text-app-muted`}>{(payment.rate * 100).toFixed(4)}%</td>
              <td className={`${td} text-right ${tone(payment.usd)}`}>{signedUsd(payment.usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {payments.length > limit && (
        <button type="button" onClick={() => setLimit((value) => value + ROWS_STEP)} className="w-full border-t border-app-hairline py-2 text-[12px] font-semibold text-app-muted hover:text-app-ink">
          Show more ({payments.length - limit} left)
        </button>
      )}
    </>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-lg bg-app-chip p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-7 rounded-md px-2.5 text-[12px] font-semibold ${value === option.value ? "bg-app-card text-app-ink shadow-xs" : "text-app-muted hover:text-app-ink"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ConnectCard({ title, text, onConnect }: { title: string; text: string; onConnect: () => void }) {
  return (
    <div className={`${card} flex flex-col items-center gap-2 px-4 py-8 text-center`}>
      <Wallet className="size-6 text-app-muted" strokeWidth={1.5} aria-hidden />
      <p className="text-[14px] font-semibold text-app-ink">{title}</p>
      <p className="max-w-sm text-[12px] text-app-muted">{text}</p>
      <button type="button" onClick={onConnect} className="mt-1 h-8 rounded-xl bg-app-accent px-3.5 text-[12px] font-semibold text-app-on-accent">
        Connect wallet
      </button>
    </div>
  );
}

const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * Full-page portfolio: perps (Hyperliquid and Lighter equity, PnL over time, positions, orders, trades, funding) and
 * spot (the Solana wallet's tokens), each on its own or together.
 */
export function PortfolioView() {
  const { address } = useWallet();
  const wallets = useWalletModal();
  const { account, accounts, marketsByVenue, lighter } = useTrading();
  const history = usePortfolioHistory();
  const spot = useSpotHoldings();
  const [mode, setMode] = useState<Mode>("all");
  const [range, setRange] = useState<Range>(30);
  const [tab, setTab] = useState<HistoryTab>("trades");

  const summaries = (Object.keys(accounts) as PerpVenueId[]).flatMap((venue) => {
    const snapshot = accounts[venue];
    return snapshot ? [summarizeVenue(venue, snapshot)] : [];
  });
  const total = totalSummary(summaries);

  const view = useMemo(() => {
    const now = Date.now();
    const since = now - range * DAY_MS;
    const hlSymbol = (coin: string) => splitCoin(coin).symbol;
    const lighterSymbol = (marketId: number) => marketsByVenue.lighter?.find((market) => market.assetId === marketId)?.symbol ?? `#${marketId}`;
    const series: Partial<Record<PerpVenueId, PnlPoint[]>> = {};
    if (history.hyperliquid) series.hyperliquid = rebase(history.hyperliquid.pnl, since);
    if (history.lighter) series.lighter = rebase(history.lighter.pnl, since);
    const pnlByVenue = Object.fromEntries(Object.entries(series).map(([venue, points]) => [venue, windowPnl([points!])])) as Partial<Record<PerpVenueId, number>>;
    return {
      series,
      pnlByVenue,
      pnl: windowPnl(Object.values(series) as PnlPoint[][]),
      daily: dailyPnl(Object.values(series) as PnlPoint[][], range, now),
      hlSymbol,
      lighterSymbol,
      since,
    };
  }, [history, range, marketsByVenue.lighter]);

  const fills = useMemo(() => {
    const hl = (history.hyperliquid?.fills ?? []).map((fill) => fromHlFill(fill, view.hlSymbol));
    const lt = lighter?.accountIndex != null ? (history.lighter?.trades ?? []).map((trade) => fromLighterTrade(trade, lighter.accountIndex!, view.lighterSymbol)) : [];
    return byTimeDesc([...hl, ...lt].filter((fill) => fill.time >= view.since));
  }, [history, lighter?.accountIndex, view]);
  const funding = useMemo(
    () => byTimeDesc((history.hyperliquid?.funding ?? []).map((entry) => fromHlFunding(entry, view.hlSymbol)).filter((payment) => payment.time >= view.since)),
    [history, view],
  );
  const totals = fillTotals(fills);
  // A venue that returned its cap of trades may have older ones in the range: volume is then a lower bound.
  const truncated = Boolean(history.hyperliquid?.truncated || history.lighter?.truncated);
  const fundingTotal = funding.reduce((sum, payment) => sum + payment.usd, 0);
  const positions = account?.positions ?? [];
  const orders = account?.orders ?? [];

  const holdings = spot.data?.holdings ?? [];
  const hidden = spot.data?.hidden ?? 0;
  const spotValue = holdingsValue(holdings);
  const sol = holdings.find((holding) => holding.symbol === "SOL");
  const stables = holdings.filter((holding) => STABLECOINS.has(holding.symbol.toUpperCase())).reduce((sum, holding) => sum + (holding.usd ?? 0), 0);
  const largest = holdings[0];
  const showPerp = mode !== "spot";
  const showSpot = mode !== "perp";
  const spotLoading = spot.loading && !spot.data;

  if (!address && !spot.address) {
    return (
      <section className="surface-panel flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-app-card/80 bg-app-card/55 p-6 text-center">
        <Wallet className="size-8 text-app-muted" strokeWidth={1.5} aria-hidden />
        <h1 className="text-[16px] font-semibold text-app-ink">Your portfolio across every venue</h1>
        <p className="max-w-sm text-[13px] text-app-muted">
          Connect a wallet to see perps on Hyperliquid and Lighter and your Solana spot tokens in one place: equity, PnL, positions and
          trade history.
        </p>
        <button type="button" onClick={wallets.open} className="mt-1 h-9 rounded-xl bg-app-accent px-4 text-[13px] font-semibold text-app-on-accent">
          Connect wallet
        </button>
      </section>
    );
  }

  const perpSection = !address ? (
    <ConnectCard title="No EVM wallet connected" text="Connect an EVM wallet to see your Hyperliquid and Lighter perps here." onConnect={wallets.open} />
  ) : (
    <>
      <div className={`grid gap-4 ${summaries.length > 0 ? "xl:grid-cols-[3fr_2fr]" : ""}`}>
        <div className={`${card} p-4`}>
          <h2 className="mb-1 text-[13px] font-semibold text-app-ink">Perp PnL, last {range} days</h2>
          {history.loading ? <p className="py-12 text-center text-[13px] text-app-muted">Loading history…</p> : <PnlChart points={view.daily} />}
        </div>
        <VenueCards rows={summaries} pnlByVenue={view.pnlByVenue} totalEquity={total.accountValue} />
      </div>

      <div className={`${card} overflow-hidden`}>
        <h2 className="border-b border-app-hairline px-4 py-2.5 text-[13px] font-semibold text-app-ink">
          Positions <span className="ml-1 tabular-nums text-app-faint">{positions.length}</span>
        </h2>
        <div className="scrollbar-subtle overflow-x-auto">
          {positions.length > 0 ? <PositionsTable positions={positions} /> : <p className="px-3 py-6 text-center text-[13px] text-app-muted">No open positions.</p>}
        </div>
      </div>

      {orders.length > 0 && (
        <div className={`${card} overflow-hidden`}>
          <h2 className="border-b border-app-hairline px-4 py-2.5 text-[13px] font-semibold text-app-ink">
            Open orders <span className="ml-1 tabular-nums text-app-faint">{orders.length}</span>
          </h2>
          <div className="scrollbar-subtle overflow-x-auto">
            <OrdersTable orders={orders} />
          </div>
        </div>
      )}
    </>
  );

  const spotSection = !spot.address ? (
    <ConnectCard title="No Solana wallet connected" text="Connect a Solana wallet to see the tokens you trade on Jupiter and Titan." onConnect={wallets.open} />
  ) : (
    <div className={`${card} overflow-hidden`}>
      <h2 className="flex items-center gap-2 border-b border-app-hairline px-4 py-2.5 text-[13px] font-semibold text-app-ink">
        Spot tokens <span className="tabular-nums text-app-faint">{holdings.length}</span>
        <span className="ml-auto text-[12px] font-normal text-app-muted">
          Solana {shortAddress(spot.address)}
          {spot.failed && <span className="text-app-down"> · couldn&apos;t refresh</span>}
        </span>
      </h2>
      <div className="scrollbar-subtle max-h-[520px] overflow-auto">
        {spotLoading ? <p className="px-3 py-6 text-center text-[13px] text-app-muted">Loading tokens…</p> : <SpotTable holdings={holdings} total={spotValue} />}
      </div>
      {hidden > 0 && (
        <p className="border-t border-app-hairline px-4 py-2 text-[11px] text-app-faint">
          {hidden} unpriced or unknown token{hidden === 1 ? "" : "s"} hidden (usually airdrop spam).
        </p>
      )}
    </div>
  );

  const historySection = address && (
    <div className={`${card} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-app-hairline px-4 py-2">
        <Segmented
          label="History"
          value={tab}
          onChange={setTab}
          options={[
            { value: "trades", label: `Trades ${fills.length}` },
            { value: "funding", label: `Funding ${funding.length}` },
          ]}
        />
        <span className="ml-auto text-[12px] tabular-nums text-app-muted">
          {tab === "trades" ? (
            <>
              Realized <span className={tone(totals.realizedPnl)}>{signedUsd(totals.realizedPnl)}</span>
            </>
          ) : (
            <>
              Net funding <span className={tone(fundingTotal)}>{signedUsd(fundingTotal)}</span>
            </>
          )}
        </span>
      </div>
      <div className="scrollbar-subtle max-h-[520px] overflow-auto">{tab === "trades" ? <TradesTable fills={fills} /> : <FundingTable payments={funding} />}</div>
    </div>
  );

  const perpTiles = (
    <>
      <Stat label={`${range}D perp PnL`} value={history.loading ? "…" : headline(view.pnl, true)} className={tone(view.pnl)} sub="Realized + unrealized" />
      <Stat label="Unrealized PnL" value={headline(total.unrealizedPnl, true)} className={tone(total.unrealizedPnl)} sub={`${positions.length} open position${positions.length === 1 ? "" : "s"}`} />
      <Stat
        label={`${range}D volume`}
        value={history.loading ? "…" : `${compactUsd.format(totals.volume)}${truncated ? "+" : ""}`}
        sub={`${totals.count.toLocaleString("en-US")}${truncated ? "+" : ""} trades`}
      />
    </>
  );

  // Children keep their height ([&>*]:shrink-0) and the page scrolls; otherwise flex squeezes the cards with
  // overflow-hidden (positions, trades) to nothing when the window is shorter than the page.
  return (
    <section className="surface-panel scrollbar-subtle flex h-full min-h-0 flex-col gap-4 overflow-auto *:shrink-0 rounded-2xl border border-app-card/80 bg-app-card/55 p-4 sm:p-5">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-app-ink">Portfolio</h1>
          <p className="text-[12px] text-app-muted">
            {[address && `EVM ${shortAddress(address)}`, spot.address && `Solana ${shortAddress(spot.address)}`].filter(Boolean).join(" · ")}
            {history.failed.length > 0 && <span className="text-app-down"> · couldn&apos;t refresh {history.failed.map((venue) => PERP_VENUE_NAMES[venue]).join(", ")}</span>}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            label="Markets"
            value={mode}
            onChange={setMode}
            options={[
              { value: "all", label: "All" },
              { value: "perp", label: "Perp" },
              { value: "spot", label: "Spot" },
            ]}
          />
          {showPerp && address && (
            <Segmented
              label="Range"
              value={range}
              onChange={setRange}
              options={[
                { value: 7, label: "7D" },
                { value: 30, label: "30D" },
              ]}
            />
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {mode === "all" && (
          <>
            <Stat label="Total equity" value={headline(total.accountValue + spotValue)} sub={`Perps ${compactUsd.format(total.accountValue)} · Spot ${compactUsd.format(spotValue)}`} />
            {perpTiles}
            <Stat label="Spot value" value={spotLoading ? "…" : headline(spotValue)} sub={`${holdings.length} token${holdings.length === 1 ? "" : "s"}`} />
            <Stat label="Margin used" value={headline(total.marginUsed)} sub={`Withdrawable ${usd.format(total.withdrawable)}`} />
          </>
        )}
        {mode === "perp" && (
          <>
            <Stat label="Perp equity" value={headline(total.accountValue)} sub={`${summaries.length} venue${summaries.length === 1 ? "" : "s"}`} />
            {perpTiles}
            <Stat label={`${range}D fees · funding`} value={history.loading ? "…" : headline(totals.fees)} sub={`Funding ${signedUsd(fundingTotal)}`} />
            <Stat label="Margin used" value={headline(total.marginUsed)} sub={`Withdrawable ${usd.format(total.withdrawable)}`} />
          </>
        )}
        {mode === "spot" && (
          <>
            <Stat label="Spot value" value={spotLoading ? "…" : headline(spotValue)} sub="Solana wallet" />
            <Stat label="Tokens" value={String(holdings.length)} sub={hidden > 0 ? `${hidden} hidden` : "All priced"} />
            <Stat label="SOL" value={sol ? sol.amount.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "0"} sub={sol?.usd != null ? usd.format(sol.usd) : "—"} />
            <Stat label="Stablecoins" value={headline(stables)} sub={spotValue > 0 ? `${((stables / spotValue) * 100).toFixed(1)}% of spot` : "—"} />
            <Stat
              label="Largest holding"
              value={largest ? largest.symbol : "—"}
              sub={largest?.usd != null ? `${usd.format(largest.usd)} · ${((largest.usd / (spotValue || 1)) * 100).toFixed(1)}%` : "—"}
            />
            <Stat label="Perp equity" value={headline(total.accountValue)} sub="Switch to Perp for details" />
          </>
        )}
      </div>

      {showPerp && perpSection}
      {showSpot && spotSection}
      {showPerp && historySection}

      <p className="text-[11px] text-app-faint">
        {showPerp &&
          `Perps: last ${HISTORY_DAYS} days, refreshed every minute. Lighter reports PnL per account, not per trade, so its trades show no fee or realized PnL and its funding is part of its PnL rather than the funding list.`}
        {showPerp && truncated && " Very active accounts show their most recent trades only, so volume and trade counts are a lower bound."}
        {showSpot && " Spot: the connected Solana wallet's tokens priced by Jupiter, refreshed every minute; spot PnL isn't tracked."}
      </p>
    </section>
  );
}
