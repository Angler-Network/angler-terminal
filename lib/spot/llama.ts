/**
 * DefiLlama's free coins API (coins.llama.fi, no key): current USD prices with a confidence score and 24h change for
 * many tokens per call, keyed "<chain>:<address>". The Uniswap list's prices come from here; DexScreener only adds
 * volume and liquidity when it answers (it silently returns nothing to rate-limited IPs). Pure, unit-tested.
 */
import type { TokenMarket } from "./listings";

/** Tokens per call: the coin keys ride in the URL path. */
export const LLAMA_BATCH = 60;

export const llamaKey = (chain: string, address: string) => `${chain}:${address.toLowerCase()}`;

const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** Price + confidence per lowercase coin key, merged with the 24h change when that call answered. */
export function readLlamaMarkets(prices: unknown, changes?: unknown): Map<string, TokenMarket> {
  const markets = new Map<string, TokenMarket>();
  const coins = ((prices as { coins?: unknown } | null)?.coins ?? {}) as Record<string, { price?: unknown; confidence?: unknown }>;
  const changed = ((changes as { coins?: unknown } | null)?.coins ?? {}) as Record<string, unknown>;
  const changeOf = new Map(Object.entries(changed).map(([key, value]) => [key.toLowerCase(), finite(value)]));
  for (const [key, coin] of Object.entries(coins)) {
    const price = finite(coin?.price);
    if (price === undefined || price <= 0) continue;
    const lower = key.toLowerCase();
    markets.set(lower, { price, confidence: finite(coin.confidence), change24h: changeOf.get(lower) });
  }
  return markets;
}
