import { describe, expect, it } from "vitest";
import type { Candle } from "./candles";
import { applyLivePrice, mergeCandles } from "./merge-candles";

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

describe("applyLivePrice", () => {
  const HOUR = 3_600_000;
  const bar = (time: number, close: number) => ({ time, open: 100, high: 110, low: 90, close, volume: 5 });

  it("updates the open candle", () => {
    expect(applyLivePrice([bar(0, 100)], 115, HOUR / 2, HOUR)).toEqual([{ time: 0, open: 100, high: 115, low: 90, close: 115, volume: 5 }]);
    expect(applyLivePrice([bar(0, 100)], 85, HOUR / 2, HOUR)[0]).toMatchObject({ low: 85, close: 85 });
  });

  it("opens the next candle once its period starts", () => {
    expect(applyLivePrice([bar(0, 104)], 106, HOUR + 60_000, HOUR)).toEqual([
      bar(0, 104),
      { time: HOUR, open: 104, high: 106, low: 104, close: 106, volume: 0 },
    ]);
  });

  it("leaves the candles alone without a usable price", () => {
    const candles = [bar(0, 100)];
    expect(applyLivePrice(candles, 0, HOUR / 2, HOUR)).toBe(candles);
    expect(applyLivePrice(candles, 100, HOUR / 2, HOUR)).toBe(candles);
    expect(applyLivePrice([], 100, 0, HOUR)).toEqual([]);
  });
});
