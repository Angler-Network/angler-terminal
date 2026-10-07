import "server-only";
import { readGeckoPoolTokens, readGeckoTokens } from "./gecko-tokens";
import type { UniswapTokenRecord } from "./listings";
import { unstable_cache } from "next/cache";
import { takeDailyBudget } from "@/lib/analytics/store";
import type { Candle, ChartInterval } from "@/lib/chart/candles";
import { readPoolTrades, type TokenTrade } from "./token-activity";
import { baseCandleCount, baseMs, MAX_POOL_CANDLES, pickPool, poolTimeframe, readOhlcv, resampleCandles, type PoolInfo, type PoolNetwork } from "./pool-candles";

const TIMEOUT_MS = 10_000;
/** Candles are refetched at most every five minutes; the chart moves its last candle with the live token price. */
const CANDLES_REVALIDATE_SECONDS = 300;
const POOL_REVALIDATE_SECONDS = 3600;
/** CoinGecko calls the terminal may spend per UTC day when a key is set (its credits may be shared with other apps). */
const DEFAULT_DAILY_BUDGET = 2500;

/**
 * Without a key: GeckoTerminal's free API (about 10 calls a minute for the whole site, no credits). With
 * `COINGECKO_API_KEY`: CoinGecko's on-chain API (`COINGECKO_API_PLAN=pro` for paid plans such as Basic, demo otherwise),
 * capped at `COINGECKO_DAILY_BUDGET` calls a day so the terminal can't use up credits another app relies on.
 */
function source() {
  const key = process.env.COINGECKO_API_KEY?.trim();
  if (!key) return { base: "https://api.geckoterminal.com/api/v2", headers: {} as Record<string, string>, budget: null };
  const pro = process.env.COINGECKO_API_PLAN?.trim() === "pro";
  const budget = Math.round(Number(process.env.COINGECKO_DAILY_BUDGET));
  return {
    base: pro ? "https://pro-api.coingecko.com/api/v3/onchain" : "https://api.coingecko.com/api/v3/onchain",
    headers: { [pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key },
    budget: budget > 0 ? budget : DEFAULT_DAILY_BUDGET,
  };
}

async function onchainJson(path: string): Promise<unknown> {
  const { base, headers, budget } = source();
  if (budget !== null && !(await takeDailyBudget("coingecko", budget))) throw new Error("Daily CoinGecko budget used up");
  const response = await fetch(`${base}${path}`, { headers: { accept: "application/json", ...headers }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  // Throwing (429 included) keeps the cache's last good answer instead of storing the failure.
  if (!response.ok) throw new Error(`On-chain data responded ${response.status} for ${path.split("?")[0]}`);
  return response.json();
}

const findPool = unstable_cache(
  async (network: PoolNetwork, address: string): Promise<PoolInfo | null> => pickPool(await onchainJson(`/networks/${network}/tokens/${address}/pools?page=1`)),
  ["spot-pool-v1"],
  { revalidate: POOL_REVALIDATE_SECONDS },
);

/** Always the full 1000 base candles: every interval and refresh size built on this timeframe shares one call. */
const poolOhlcv = unstable_cache(
  async (network: PoolNetwork, pool: string, token: string, timeframe: string, aggregate: number): Promise<Candle[]> =>
    readOhlcv(await onchainJson(`/networks/${network}/pools/${pool}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${MAX_POOL_CANDLES}&currency=usd&token=${token}`)),
  ["spot-ohlcv-v2"],
  { revalidate: CANDLES_REVALIDATE_SECONDS },
);

/** The token's busiest pool and its last `count` candles in USD; null when no indexed pool trades it. */
export async function getPoolCandles(network: PoolNetwork, address: string, interval: ChartInterval, count: number) {
  const pool = await findPool(network, address);
  if (!pool) return null;
  const frame = poolTimeframe(interval);
  const base = await poolOhlcv(network, pool.address, address, frame.timeframe, frame.aggregate);
  // Take whole buckets' worth of base candles from the end, then merge them.
  const recent = base.slice(-baseCandleCount(interval, count + 1));
  return { pool, candles: resampleCandles(recent, baseMs(interval), frame.factor).slice(-count) };
}

/** Recent swaps are refetched at most once a minute per pool (the free API allows about 10 calls a minute site-wide). */
const TRADES_REVALIDATE_SECONDS = 60;

const poolTrades = unstable_cache(
  async (network: PoolNetwork, pool: string, token: string): Promise<TokenTrade[]> =>
    readPoolTrades(await onchainJson(`/networks/${network}/pools/${pool}/trades`), network, token),
  ["spot-trades-v1"],
  { revalidate: TRADES_REVALIDATE_SECONDS },
);

/** The last swaps (up to 300, 24h) in the token's busiest pool, newest first; null when no indexed pool trades it. */
export async function getPoolTrades(network: PoolNetwork, address: string) {
  const pool = await findPool(network, address);
  if (!pool) return null;
  const trades = await poolTrades(network, pool.address, address);
  return { pool: pool.address, trades: [...trades].sort((a, b) => b.at - a.at) };
}

/** The tokens of a network's busiest pools (three pages, ~40 tokens), refetched every 15 minutes. */
export const getTopPoolTokens = unstable_cache(
  async (network: PoolNetwork, chainId: number): Promise<UniswapTokenRecord[]> => {
    const pages = await Promise.all(
      [1, 2, 3].map((page) => onchainJson(`/networks/${network}/pools?page=${page}&sort=h24_volume_usd_desc&include=base_token,quote_token`).catch(() => null)),
    );
    // Every page failing (429 included) throws, so the cache keeps the last good list.
    if (pages.every((page) => page === null)) throw new Error(`Top pools for ${network} are unavailable`);
    const seen = new Set<string>();
    return pages.flatMap((page) => readGeckoPoolTokens(page, chainId)).filter((token) => !seen.has(token.address!.toLowerCase()) && Boolean(seen.add(token.address!.toLowerCase())));
  },
  ["spot-top-pool-tokens-v1"],
  { revalidate: 15 * 60 },
);

/**
 * Price, 24h volume, liquidity and market cap for up to `GECKO_TOKENS_BATCH` tokens per call (`tokens/multi`), the
 * fallback when DexScreener leaves EVM tokens bare. Same key, plan and daily budget as the pool charts.
 */
export async function getOnchainTokenStats(network: PoolNetwork, addresses: string[]) {
  return readGeckoTokens(await onchainJson(`/networks/${network}/tokens/multi/${addresses.join(",")}`));
}
