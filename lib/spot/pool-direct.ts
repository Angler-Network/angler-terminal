"use client";

import type { Candle, ChartInterval } from "@/lib/chart/candles";
import { baseCandleCount, baseMs, MAX_POOL_CANDLES, pickPool, poolTimeframe, readOhlcv, resampleCandles, type PoolInfo, type PoolNetwork } from "./pool-candles";
import { readPoolTrades, type TokenTrade } from "./token-activity";

/**
 * Pool candles and swaps fetched by the browser straight from GeckoTerminal's free API (it answers any origin, no key),
 * so each visitor spends their own IP's allowance (about 30 calls a minute) instead of the site's shared one: with
 * every chart and Swaps tab going through our server, a launch crowd opening a thousand different tokens would use up
 * the CoinGecko plan whatever its size. Same parsers as the server (`pool-candles-server.ts`), which stays the fallback
 * when this fails (rate limited, blocked by an extension).
 *
 * Base candles are kept in memory for a few minutes: the chart's 30-second refresh then costs no call, and the live
 * token price moves the last candle in between (`applyLivePrice`).
 */

const BASE = "https://api.geckoterminal.com/api/v2";
const TIMEOUT_MS = 10_000;
const CANDLES_TTL_MS = 3 * 60_000;
const POOL_TTL_MS = 60 * 60_000;
const MAX_ENTRIES = 60;

type Entry<T> = { at: number; value: Promise<T> };
const pools = new Map<string, Entry<PoolInfo | null>>();
const candles = new Map<string, Entry<Candle[]>>();

async function gecko(path: string): Promise<unknown> {
  const response = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`GeckoTerminal responded ${response.status}`);
  return response.json();
}

/** Keeps a promise for `ttl`; a failed one is dropped at once so the next call (or the server) can try again. */
function remember<T>(cache: Map<string, Entry<T>>, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = load();
  // A long session opens many tokens: the oldest entry goes first.
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.get(key)?.value === value && cache.delete(key));
  return value;
}

function findPool(network: PoolNetwork, address: string) {
  return remember(pools, `${network}:${address}`, POOL_TTL_MS, async () => pickPool(await gecko(`/networks/${network}/tokens/${address}/pools?page=1`)));
}

/** The token's busiest pool and its last `count` candles in USD; null when no indexed pool trades it. Throws when GeckoTerminal fails. */
export async function directPoolCandles(network: PoolNetwork, address: string, interval: ChartInterval, count: number) {
  const pool = await findPool(network, address);
  if (!pool) return null;
  const frame = poolTimeframe(interval);
  const base = await remember(candles, `${network}:${pool.address}:${frame.timeframe}:${frame.aggregate}`, CANDLES_TTL_MS, async () =>
    readOhlcv(await gecko(`/networks/${network}/pools/${pool.address}/ohlcv/${frame.timeframe}?aggregate=${frame.aggregate}&limit=${MAX_POOL_CANDLES}&currency=usd&token=${address}`)),
  );
  const recent = base.slice(-baseCandleCount(interval, count + 1));
  return { pool, candles: resampleCandles(recent, baseMs(interval), frame.factor).slice(-count) };
}

/** The last swaps in the token's busiest pool, newest first; null when no indexed pool trades it. Throws when GeckoTerminal fails. */
export async function directPoolTrades(network: PoolNetwork, address: string): Promise<{ pool: string; trades: TokenTrade[] } | null> {
  const pool = await findPool(network, address);
  if (!pool) return null;
  const trades = readPoolTrades(await gecko(`/networks/${network}/pools/${pool.address}/trades`), network, address);
  return { pool: pool.address, trades: [...trades].sort((a, b) => b.at - a.at) };
}
