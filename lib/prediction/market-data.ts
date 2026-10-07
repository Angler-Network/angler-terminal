import type { PredictionSource } from "./types";

/** Price history and order books from both sources in one shape (prices are probabilities, 0-1). */

export type PredictionRange = "1d" | "1w" | "1m" | "all";
export const PREDICTION_RANGES: PredictionRange[] = ["1d", "1w", "1m", "all"];

export function isPredictionRange(value: unknown): value is PredictionRange {
  return typeof value === "string" && (PREDICTION_RANGES as string[]).includes(value);
}

/** Seconds since epoch and price. */
export interface PricePoint {
  t: number;
  p: number;
}

export interface BookLevel {
  price: number;
  size: number;
}

/** Bids best (highest) first, asks best (lowest) first. */
export interface PredictionBook {
  bids: BookLevel[];
  asks: BookLevel[];
}

const finite = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/** Polymarket `{ history: [{ t, p }] }` (seconds) or Hyperliquid candles (`t` ms, close `c`), oldest first. */
export function readHistory(source: PredictionSource, body: unknown): PricePoint[] {
  const points: PricePoint[] = [];
  if (source === "polymarket") {
    const history = (body as { history?: unknown } | null)?.history;
    for (const entry of Array.isArray(history) ? history : []) {
      const t = finite((entry as { t?: unknown }).t);
      const p = finite((entry as { p?: unknown }).p);
      if (t !== null && p !== null) points.push({ t: Math.floor(t), p });
    }
  } else {
    for (const candle of Array.isArray(body) ? body : []) {
      const t = finite((candle as { t?: unknown }).t);
      const p = finite((candle as { c?: unknown }).c);
      if (t !== null && p !== null) points.push({ t: Math.floor(t / 1000), p });
    }
  }
  // The chart needs strictly increasing times.
  points.sort((a, b) => a.t - b.t);
  return points.filter((point, index) => index === 0 || point.t > points[index - 1].t);
}

function levels(value: unknown, priceKey: string, sizeKey: string): BookLevel[] {
  return (Array.isArray(value) ? value : []).flatMap((level) => {
    const price = finite((level as Record<string, unknown>)[priceKey]);
    const size = finite((level as Record<string, unknown>)[sizeKey]);
    return price !== null && size !== null && size > 0 ? [{ price, size }] : [];
  });
}

/** Polymarket `{ bids, asks }` (worst first) or Hyperliquid `l2Book` `{ levels: [bids, asks] }`. */
export function readBook(source: PredictionSource, body: unknown): PredictionBook {
  const record = (body ?? {}) as Record<string, unknown>;
  const [rawBids, rawAsks] =
    source === "polymarket" ? [levels(record.bids, "price", "size"), levels(record.asks, "price", "size")] : [levels((record.levels as unknown[] | undefined)?.[0], "px", "sz"), levels((record.levels as unknown[] | undefined)?.[1], "px", "sz")];
  return { bids: rawBids.sort((a, b) => b.price - a.price), asks: rawAsks.sort((a, b) => a.price - b.price) };
}

/**
 * What a market buy of `usd` costs through the asks: shares received and the average price, null when the book is
 * too thin to fill it.
 */
export function walkAsks(asks: BookLevel[], usd: number): { shares: number; average: number } | null {
  let left = usd;
  let shares = 0;
  for (const level of asks) {
    const cost = level.price * level.size;
    if (cost >= left) {
      shares += left / level.price;
      left = 0;
      break;
    }
    shares += level.size;
    left -= cost;
  }
  return left > 1e-9 || shares === 0 ? null : { shares, average: usd / shares };
}
