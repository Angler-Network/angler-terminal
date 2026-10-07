import type { OrderSide, PerpVenueId } from "@/lib/venues/types";

/**
 * Account history for the portfolio page: PnL over a window and recent fills, normalized across perp venues.
 * Pure, unit-tested; the fetching lives in each venue's `history.ts`.
 */

/** PnL since the start of the window, in USD. */
export interface PnlPoint {
  time: number;
  pnl: number;
}

export interface HistoryFill {
  id: string;
  venue: PerpVenueId;
  time: number;
  symbol: string;
  side: OrderSide;
  size: number;
  price: number;
  usd: number;
  /** Fee paid in USD, when the venue reports it. */
  fee: number | null;
  /** PnL realized by this fill (closing fills), when the venue reports it. */
  realizedPnl: number | null;
  /** "Open Long", "Close Short"... when the venue reports it. */
  direction: string | null;
  /** Signed position size just before this fill, when the venue reports it (Hyperliquid). */
  startPosition?: number;
}

export interface FundingPayment {
  venue: PerpVenueId;
  time: number;
  symbol: string;
  /** Positive when received, negative when paid. */
  usd: number;
  rate: number;
}

const DAY_MS = 86_400_000;

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** Hyperliquid `portfolio` pnlHistory ([ms, cumulative pnl]) rebased to the window start. */
export function hlPnlSeries(history: ReadonlyArray<readonly [number, string]>, since: number): PnlPoint[] {
  const points = history.map(([time, value]) => ({ time, value: toNumber(value) })).filter((point) => point.time >= since);
  const base = points[0]?.value ?? 0;
  return points.map((point) => ({ time: point.time, pnl: point.value - base }));
}

/** Lighter `pnl` entries (seconds, cumulative trade_pnl) rebased to the window start. */
export function lighterPnlSeries(entries: ReadonlyArray<{ timestamp: number; trade_pnl: number }>, since: number): PnlPoint[] {
  const points = entries
    .map((entry) => ({ time: entry.timestamp * 1000, value: toNumber(entry.trade_pnl) }))
    .filter((point) => point.time >= since)
    .sort((a, b) => a.time - b.time);
  const base = points[0]?.value ?? 0;
  return points.map((point) => ({ time: point.time, pnl: point.value - base }));
}

/** The series' value at `time`: its last point at or before it, 0 before the first. */
function valueAt(series: PnlPoint[], time: number) {
  let value = 0;
  for (const point of series) {
    if (point.time > time) break;
    value = point.pnl;
  }
  return value;
}

/** A window series narrowed to `since`, measured from its value there. */
export function rebase(series: PnlPoint[], since: number): PnlPoint[] {
  const base = valueAt(series, since);
  return series.filter((point) => point.time > since).map((point) => ({ time: point.time, pnl: point.pnl - base }));
}

/**
 * Venues' PnL summed per UTC day for the last `days` days (oldest first), each day at its close (now for today), so
 * venues with differently spaced points line up.
 */
export function dailyPnl(seriesList: PnlPoint[][], days: number, now: number): PnlPoint[] {
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
  return Array.from({ length: days }, (_, index) => {
    const dayStart = todayStart - (days - 1 - index) * DAY_MS;
    const time = Math.min(now, dayStart + DAY_MS - 1);
    return { time: dayStart, pnl: seriesList.reduce((sum, series) => sum + valueAt(series, time), 0) };
  });
}

/** PnL over the whole window: the last point of each series. */
export function windowPnl(seriesList: PnlPoint[][]) {
  return seriesList.reduce((sum, series) => sum + (series.at(-1)?.pnl ?? 0), 0);
}

export interface HlFill {
  coin: string;
  px: string;
  sz: string;
  side: "B" | "A";
  time: number;
  dir: string;
  closedPnl: string;
  fee: string;
  tid: number;
  /** Signed position size before the fill. */
  startPosition?: string;
}

/** Hyperliquid fill → history row. `symbolOf` turns a coin ("BTC", "xyz:NVDA") into its display symbol. */
export function fromHlFill(fill: HlFill, symbolOf: (coin: string) => string): HistoryFill {
  const size = toNumber(fill.sz);
  const price = toNumber(fill.px);
  const realized = toNumber(fill.closedPnl);
  return {
    id: `hyperliquid:${fill.tid}`,
    venue: "hyperliquid",
    time: fill.time,
    symbol: symbolOf(fill.coin),
    side: fill.side === "B" ? "buy" : "sell",
    size,
    price,
    usd: size * price,
    fee: toNumber(fill.fee),
    // Opening fills report 0; only closes realize PnL.
    realizedPnl: fill.dir.startsWith("Close") || realized !== 0 ? realized : null,
    direction: fill.dir || null,
    ...(fill.startPosition !== undefined && { startPosition: toNumber(fill.startPosition) }),
  };
}

export interface LighterTrade {
  trade_id: number;
  market_id: number;
  size: string;
  price: string;
  usd_amount: string;
  bid_account_id: number;
  ask_account_id: number;
  timestamp: number;
}

/** Lighter trade → history row from `accountIndex`'s side. Lighter reports no per-trade fee or realized PnL. */
export function fromLighterTrade(trade: LighterTrade, accountIndex: number, symbolOf: (marketId: number) => string): HistoryFill {
  return {
    id: `lighter:${trade.trade_id}`,
    venue: "lighter",
    time: trade.timestamp,
    symbol: symbolOf(trade.market_id),
    side: trade.bid_account_id === accountIndex ? "buy" : "sell",
    size: toNumber(trade.size),
    price: toNumber(trade.price),
    usd: toNumber(trade.usd_amount),
    fee: null,
    realizedPnl: null,
    direction: null,
  };
}

export interface HlFundingEntry {
  time: number;
  delta: { coin: string; usdc: string; fundingRate: string };
}

export function fromHlFunding(entry: HlFundingEntry, symbolOf: (coin: string) => string): FundingPayment {
  return {
    venue: "hyperliquid",
    time: entry.time,
    symbol: symbolOf(entry.delta.coin),
    usd: toNumber(entry.delta.usdc),
    rate: toNumber(entry.delta.fundingRate),
  };
}

export interface FillTotals {
  volume: number;
  fees: number;
  realizedPnl: number;
  count: number;
}

export function fillTotals(fills: HistoryFill[]): FillTotals {
  return fills.reduce(
    (total, fill) => ({
      volume: total.volume + fill.usd,
      fees: total.fees + (fill.fee ?? 0),
      realizedPnl: total.realizedPnl + (fill.realizedPnl ?? 0),
      count: total.count + 1,
    }),
    { volume: 0, fees: 0, realizedPnl: 0, count: 0 },
  );
}

/** Newest first. */
export function byTimeDesc<T extends { time: number }>(rows: T[]) {
  return [...rows].sort((a, b) => b.time - a.time);
}
