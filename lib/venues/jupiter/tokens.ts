import type { SpotToken } from "../types";

/** The subset of a Tokens V2 record (GET /tokens/v2/search) the terminal uses. */
export interface JupTokenRecord {
  id: string;
  name?: string;
  symbol?: string;
  icon?: string;
  decimals?: number;
  usdPrice?: number;
  liquidity?: number;
  isVerified?: boolean;
  tags?: string[];
}

export function toSpotToken(record: JupTokenRecord): SpotToken | null {
  if (typeof record.id !== "string" || !Number.isInteger(record.decimals)) return null;
  return {
    mint: record.id,
    symbol: record.symbol ?? "",
    name: record.name ?? record.symbol ?? "",
    decimals: record.decimals!,
    icon: record.icon,
    usdPrice: typeof record.usdPrice === "number" ? record.usdPrice : undefined,
    liquidity: typeof record.liquidity === "number" ? record.liquidity : undefined,
    isVerified: record.isVerified === true || Boolean(record.tags?.includes("verified")),
  };
}

/** Some verified tokens carry a "$" in their symbol (e.g. "$WIF"); compare without it. */
export function normalizeSymbol(symbol: string) {
  return symbol.trim().replace(/^\$/, "").toUpperCase();
}

/**
 * Picks the token to trade. A mint must match exactly and be verified. A symbol matches case-insensitively among
 * verified tokens only; when several share it, the one with the most liquidity wins.
 */
export function pickVerifiedToken(records: JupTokenRecord[], query: { symbol?: string; mint?: string }) {
  const tokens = records.flatMap((record) => toSpotToken(record) ?? []).filter((token) => token.isVerified);
  if (query.mint) return tokens.find((token) => token.mint === query.mint) ?? null;
  const wanted = query.symbol ? normalizeSymbol(query.symbol) : "";
  if (!wanted) return null;
  const matches = tokens.filter((token) => normalizeSymbol(token.symbol) === wanted);
  matches.sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0));
  return matches[0] ?? null;
}
