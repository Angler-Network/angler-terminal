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

/**
 * Moves the chart with a live price between candle fetches: inside the last candle's period it updates close, high
 * and low; once a new period has started it opens a candle there from the last close. Periods align to multiples
 * of `intervalMs` (UTC epoch), like the candles themselves.
 */
export function applyLivePrice(candles: Candle[], price: number, now: number, intervalMs: number): Candle[] {
  const last = candles[candles.length - 1];
  if (!last || !(price > 0) || !(intervalMs > 0)) return candles;
  const start = Math.floor(now / intervalMs) * intervalMs;
  if (start <= last.time) {
    if (last.close === price && price <= last.high && price >= last.low) return candles;
    return [...candles.slice(0, -1), { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) }];
  }
  return [...candles, { time: start, open: last.close, high: Math.max(last.close, price), low: Math.min(last.close, price), close: price, volume: 0 }];
}
