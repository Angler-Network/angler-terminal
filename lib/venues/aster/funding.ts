/**
 * Aster funding for the cross-venue funding table: `premiumIndex` (last rate per symbol) and `fundingInfo` (each
 * symbol's interval), turned into the funding feed's rows, normalized to 8 hours like the other venues. A base asset
 * listed against several quotes (USDT, USD1) keeps its USDT market. Pure, unit-tested.
 */

export const ASTER_API_URL = "https://fapi.asterdex.com";

const QUOTES = ["USDT", "USD1"] as const;

export interface AsterPremium {
  symbol?: unknown;
  markPrice?: unknown;
  lastFundingRate?: unknown;
}

export interface AsterFundingInfo {
  symbol?: unknown;
  fundingIntervalHours?: unknown;
}

/** "BTCUSDT" → { base: "BTC", quote: "USDT" }; null for quotes the terminal doesn't read. */
export function splitAsterSymbol(symbol: string) {
  const quote = QUOTES.find((candidate) => symbol.endsWith(candidate) && symbol.length > candidate.length);
  return quote ? { base: symbol.slice(0, -quote.length), quote } : null;
}

export function asterFundingRows(premium: AsterPremium[], info: AsterFundingInfo[]) {
  const hours = new Map(info.map((entry) => [String(entry.symbol), Number(entry.fundingIntervalHours)]));
  const byBase = new Map<string, { quote: string; rate: number }>();
  for (const entry of premium) {
    const symbol = typeof entry.symbol === "string" ? entry.symbol : "";
    const split = splitAsterSymbol(symbol);
    const rate = Number(entry.lastFundingRate);
    if (!split || !(Number(entry.markPrice) > 0) || !Number.isFinite(rate)) continue;
    const interval = hours.get(symbol);
    const per8h = rate * (8 / (interval && interval > 0 ? interval : 8));
    const current = byBase.get(split.base);
    if (!current || (current.quote !== "USDT" && split.quote === "USDT")) byBase.set(split.base, { quote: split.quote, rate: per8h });
  }
  return [...byBase].map(([symbol, { rate }]) => ({ exchange: "aster", symbol, rate }));
}
