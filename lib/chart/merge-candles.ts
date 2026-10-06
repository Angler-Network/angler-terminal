import type { Candle } from "./candles";

/**
 * Applies a refresh that only fetched the latest candles: candles from the tail's first time on are replaced (the
 * open one keeps changing), older ones are kept, and the oldest are dropped past `max`. Both lists are oldest first.
 */
export function mergeCandles(existing: Candle[], tail: Candle[], max: number): Candle[] {
  if (tail.length === 0) return existing;
  const from = tail[0].time;
  let keep = existing.length;
  while (keep > 0 && existing[keep - 1].time >= from) keep--;
  const merged = keep === existing.length ? existing.concat(tail) : existing.slice(0, keep).concat(tail);
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}
