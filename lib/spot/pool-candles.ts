/**
 * A spot token's own price chart (cbBTC, not "BTC"): candles of its busiest DEX pool from GeckoTerminal's on-chain
 * data. Pure helpers, unit-tested; the server side is `pool-candles-server.ts`.
 */
import type { Candle, ChartInterval } from "@/lib/chart/candles";

/** GeckoTerminal networks for the spot venues' chains: Jupiter on Solana, Arcus on Robinhood Chain, Uniswap on EVM. */
export type PoolNetwork = "solana" | "robinhood" | "eth" | "base" | "arbitrum";

export interface PoolInfo {
  address: string;
  /** "cbBTC / USDC". */
  name: string;
  /** "orca", "meteora"… */
  dex: string;
}

/** GeckoTerminal serves minute (1, 5, 15), hour (1, 4, 12) and day (1) candles; other intervals merge those. */
type Timeframe = { timeframe: "minute" | "hour" | "day"; aggregate: number; factor: number };

const TIMEFRAMES: Record<ChartInterval, Timeframe> = {
  "1m": { timeframe: "minute", aggregate: 1, factor: 1 },
  "3m": { timeframe: "minute", aggregate: 1, factor: 3 },
  "5m": { timeframe: "minute", aggregate: 5, factor: 1 },
  "15m": { timeframe: "minute", aggregate: 15, factor: 1 },
  "30m": { timeframe: "minute", aggregate: 15, factor: 2 },
  "1h": { timeframe: "hour", aggregate: 1, factor: 1 },
  "2h": { timeframe: "hour", aggregate: 1, factor: 2 },
  "4h": { timeframe: "hour", aggregate: 4, factor: 1 },
  "8h": { timeframe: "hour", aggregate: 4, factor: 2 },
  "12h": { timeframe: "hour", aggregate: 12, factor: 1 },
  "1d": { timeframe: "day", aggregate: 1, factor: 1 },
  "3d": { timeframe: "day", aggregate: 1, factor: 3 },
  "1w": { timeframe: "day", aggregate: 1, factor: 7 },
  "1M": { timeframe: "day", aggregate: 1, factor: 30 },
};

/** The most GeckoTerminal returns per request. */
export const MAX_POOL_CANDLES = 1000;

export function poolTimeframe(interval: ChartInterval) {
  return TIMEFRAMES[interval];
}

/** Base candles to request for `count` chart candles (capped by the API). */
export function baseCandleCount(interval: ChartInterval, count: number) {
  return Math.min(MAX_POOL_CANDLES, Math.max(1, Math.ceil(count)) * TIMEFRAMES[interval].factor);
}

/**
 * `ohlcv_list` rows ([seconds, open, high, low, close, volume in USD], newest first) as candles in ms, oldest first.
 * Malformed rows are dropped.
 */
export function readOhlcv(body: unknown): Candle[] {
  const list = (body as { data?: { attributes?: { ohlcv_list?: unknown } } })?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return [];
  const candles = list.flatMap((row): Candle[] => {
    if (!Array.isArray(row) || row.length < 6) return [];
    const [time, open, high, low, close, volume] = row.map(Number);
    return [time, open, high, low, close].every((value) => Number.isFinite(value) && value > 0) && Number.isFinite(volume)
      ? [{ time: time * 1000, open, high, low, close, volume }]
      : [];
  });
  return candles.sort((a, b) => a.time - b.time);
}

/**
 * Merges base candles into `factor`-sized ones aligned to multiples of the merged duration (UTC epoch), so a 30m chart
 * built from 15m candles starts at :00 and :30. Buckets keep first open, highest high, lowest low, last close, summed
 * volume.
 */
export function resampleCandles(candles: Candle[], baseMs: number, factor: number): Candle[] {
  if (factor <= 1) return candles;
  const size = baseMs * factor;
  const buckets = new Map<number, Candle>();
  for (const candle of candles) {
    const start = Math.floor(candle.time / size) * size;
    const bucket = buckets.get(start);
    if (!bucket) buckets.set(start, { ...candle, time: start });
    else {
      bucket.high = Math.max(bucket.high, candle.high);
      bucket.low = Math.min(bucket.low, candle.low);
      bucket.close = candle.close;
      bucket.volume += candle.volume;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

/** Milliseconds of one base candle. */
export function baseMs(interval: ChartInterval) {
  const { timeframe, aggregate } = TIMEFRAMES[interval];
  return aggregate * (timeframe === "minute" ? 60_000 : timeframe === "hour" ? 3_600_000 : 86_400_000);
}

interface GtPool {
  id?: string;
  attributes?: { address?: string; name?: string; volume_usd?: { h24?: string | number }; reserve_in_usd?: string | number };
  relationships?: { dex?: { data?: { id?: string } } };
}

/** The token's busiest pool (24h volume, then reserve): where its price is actually made. */
export function pickPool(body: unknown): PoolInfo | null {
  const pools = (body as { data?: GtPool[] })?.data;
  if (!Array.isArray(pools)) return null;
  const ranked = pools
    .map((pool) => ({
      address: pool.attributes?.address ?? "",
      name: pool.attributes?.name ?? "",
      dex: pool.relationships?.dex?.data?.id ?? "",
      volume: Number(pool.attributes?.volume_usd?.h24) || 0,
      reserve: Number(pool.attributes?.reserve_in_usd) || 0,
    }))
    .filter((pool) => pool.address)
    .sort((a, b) => b.volume - a.volume || b.reserve - a.reserve);
  const best = ranked[0];
  return best ? { address: best.address, name: best.name, dex: best.dex } : null;
}

const ADDRESS: Record<PoolNetwork, RegExp> = {
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  robinhood: /^0x[0-9a-fA-F]{40}$/,
  eth: /^0x[0-9a-fA-F]{40}$/,
  base: /^0x[0-9a-fA-F]{40}$/,
  arbitrum: /^0x[0-9a-fA-F]{40}$/,
};

export function isPoolNetwork(value: unknown): value is PoolNetwork {
  return typeof value === "string" && Object.hasOwn(ADDRESS, value);
}

export function isTokenAddress(network: PoolNetwork, address: string) {
  return ADDRESS[network].test(address);
}
