import { describe, expect, it } from "vitest";
import type { Candle } from "./candles";
import { mergeCandles } from "./merge-candles";

const candle = (time: number, close = time): Candle => ({ time, open: close, high: close, low: close, close, volume: 1 });

describe("mergeCandles", () => {
  it("replaces the open candle and appends new ones", () => {
    const merged = mergeCandles([candle(1), candle(2), candle(3, 30)], [candle(3, 31), candle(4)], 10);
    expect(merged.map((c) => [c.time, c.close])).toEqual([
      [1, 1],
      [2, 2],
      [3, 31],
      [4, 4],
    ]);
  });

  it("drops the oldest candles past the cap", () => {
    expect(mergeCandles([candle(1), candle(2), candle(3)], [candle(3), candle(4), candle(5)], 3).map((c) => c.time)).toEqual([3, 4, 5]);
  });

  it("keeps the list when the refresh returned nothing", () => {
    const existing = [candle(1)];
    expect(mergeCandles(existing, [], 10)).toBe(existing);
  });

  it("fills a gap after the tab was hidden", () => {
    expect(mergeCandles([candle(1), candle(2)], [candle(5), candle(6)], 10).map((c) => c.time)).toEqual([1, 2, 5, 6]);
  });
});
