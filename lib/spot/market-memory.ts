/**
 * The last good volume / liquidity / market cap per EVM token, so a refresh where every source is rate limited keeps
 * showing recent numbers instead of blanks. Stored as compact JSON per token (Redis hash on the server, memory
 * without it); entries older than `MARKET_MEMORY_TTL_MS` are ignored. Pure, unit-tested.
 */
import type { TokenMarket } from "./listings";

export const MARKET_MEMORY_TTL_MS = 6 * 60 * 60 * 1000;

interface Remembered {
  v?: number;
  l?: number;
  m?: number;
  at: number;
}

/** What's worth remembering from a market (null when it has no volume or liquidity). */
export function encodeMarket(market: TokenMarket, now = Date.now()): string | null {
  if (market.volume24h === undefined && market.liquidity === undefined) return null;
  const remembered: Remembered = { v: market.volume24h, l: market.liquidity, m: market.marketCap, at: now };
  return JSON.stringify(remembered);
}

export function decodeMarket(value: unknown, now = Date.now()): TokenMarket | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as Remembered;
    if (typeof parsed.at !== "number" || now - parsed.at > MARKET_MEMORY_TTL_MS) return null;
    const finite = (entry: unknown) => (typeof entry === "number" && Number.isFinite(entry) ? entry : undefined);
    return { volume24h: finite(parsed.v), liquidity: finite(parsed.l), marketCap: finite(parsed.m) };
  } catch {
    return null;
  }
}

/** Fills the fields `fresh` lacks from the sources after it, in order (undefined never overwrites a value). */
export function fillMarket(fresh: TokenMarket | undefined, ...fallbacks: Array<TokenMarket | null | undefined>): TokenMarket {
  const merged: TokenMarket = { ...fresh };
  for (const fallback of fallbacks) {
    if (!fallback) continue;
    for (const [key, value] of Object.entries(fallback) as Array<[keyof TokenMarket, TokenMarket[keyof TokenMarket]]>) {
      if (merged[key] === undefined && value !== undefined) (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

/** Whether a token still lacks the numbers the fallbacks are for. */
export const needsStats = (market: TokenMarket | undefined) => market?.volume24h === undefined || market?.liquidity === undefined;
