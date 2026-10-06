import "server-only";
import { unstable_cache } from "next/cache";
import { anglerConfig } from "@/lib/angler/env";
import { readApiNewsPage } from "@/lib/angler/map";
import { distinctEvents, reactionStats, readHlCandles, REACTION_HORIZONS_MIN, type Candle, type NewsReaction } from "./reaction";

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const STEP_MS = 15 * 60_000;
/** Hyperliquid returns at most 5000 candles: about 52 days of 15-minute candles. */
const WINDOW_MS = 50 * 24 * 60 * 60_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 4;
const TIMEOUT_MS = 10_000;
const REVALIDATE_SECONDS = 15 * 60;

/** Mainnet prices whatever network the terminal trades on: history is about the real market. */
async function loadCandles(coin: string, startTime: number): Promise<Candle[]> {
  const response = await fetch(HL_INFO_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval: "15m", startTime, endTime: Date.now() } }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return response.ok ? readHlCandles(await response.json()) : [];
}

/** Publish times of the asset's past news at or above `minImpact`, newest pages first, inside the candle window. */
async function loadNewsTimes(symbol: string, minImpact: number, since: number) {
  const { apiUrl, key } = anglerConfig();
  if (!key) throw new Error("ANGLER_API_KEY is not set");
  const times: number[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ coin: symbol, min_importance: String(minImpact), limit: String(PAGE_SIZE) });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`${apiUrl}/v1/news?${params}`, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Angler API responded ${response.status}`);
    const { items, next_cursor } = readApiNewsPage(await response.json());
    let reachedStart = false;
    for (const item of items) {
      const time = Date.parse(item.published_at);
      if (time < since) reachedStart = true;
      else if (item.is_unique !== false) times.push(time);
    }
    cursor = next_cursor;
    if (!cursor || reachedStart) break;
  }
  return times;
}

async function computeReaction(symbol: string, minImpact: number): Promise<NewsReaction> {
  const since = Date.now() - WINDOW_MS;
  const [times, main] = await Promise.all([loadNewsTimes(symbol, minImpact, since), loadCandles(symbol, since)]);
  // Equities trade on the xyz HIP-3 dex.
  const candles = main.length > 0 ? main : await loadCandles(`xyz:${symbol}`, since);
  const events = distinctEvents(times);
  return { symbol, minImpact, events: events.length, horizons: reactionStats(events, candles, STEP_MS, REACTION_HORIZONS_MIN) };
}

/** Cached per asset and impact bucket: every viewer of the same coin shares one computation. */
export const getNewsReaction = unstable_cache(computeReaction, ["news-reaction-v1"], { revalidate: REVALIDATE_SECONDS });
