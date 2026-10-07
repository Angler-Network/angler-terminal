import "server-only";
import { unstable_cache } from "next/cache";
import type { Candle, ChartInterval } from "@/lib/chart/candles";
import { baseCandleCount, baseMs, pickPool, poolTimeframe, readOhlcv, resampleCandles, type PoolInfo, type PoolNetwork } from "./pool-candles";

const TIMEOUT_MS = 10_000;

/**
 * GeckoTerminal's free API allows about 10 calls a minute, shared by every visitor, so everything here is cached across
 * requests (pool per token for an hour, candles for a minute). With `COINGECKO_API_KEY` the same data comes from
 * CoinGecko's on-chain endpoints instead (`COINGECKO_API_PLAN=pro` for a paid key, demo otherwise).
 */
function source() {
  const key = process.env.COINGECKO_API_KEY?.trim();
  if (!key) return { base: "https://api.geckoterminal.com/api/v2", headers: {} as Record<string, string> };
  const pro = process.env.COINGECKO_API_PLAN?.trim() === "pro";
  return {
    base: pro ? "https://pro-api.coingecko.com/api/v3/onchain" : "https://api.coingecko.com/api/v3/onchain",
    headers: { [pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key },
  };
}

async function onchainJson(path: string): Promise<unknown> {
  const { base, headers } = source();
  const response = await fetch(`${base}${path}`, { headers: { accept: "application/json", ...headers }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  // Throwing (429 included) keeps the cache's last good answer instead of storing the failure.
  if (!response.ok) throw new Error(`On-chain data responded ${response.status} for ${path.split("?")[0]}`);
  return response.json();
}

const findPool = unstable_cache(
  async (network: PoolNetwork, address: string): Promise<PoolInfo | null> => pickPool(await onchainJson(`/networks/${network}/tokens/${address}/pools?page=1`)),
  ["spot-pool-v1"],
  { revalidate: 3600 },
);

const poolOhlcv = unstable_cache(
  async (network: PoolNetwork, pool: string, token: string, timeframe: string, aggregate: number, limit: number): Promise<Candle[]> =>
    readOhlcv(await onchainJson(`/networks/${network}/pools/${pool}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=usd&token=${token}`)),
  ["spot-ohlcv-v1"],
  { revalidate: 60 },
);

/** The token's busiest pool and its last `count` candles in USD; null when no indexed pool trades it. */
export async function getPoolCandles(network: PoolNetwork, address: string, interval: ChartInterval, count: number) {
  const pool = await findPool(network, address);
  if (!pool) return null;
  const frame = poolTimeframe(interval);
  const base = await poolOhlcv(network, pool.address, address, frame.timeframe, frame.aggregate, baseCandleCount(interval, count));
  return { pool, candles: resampleCandles(base, baseMs(interval), frame.factor) };
}
