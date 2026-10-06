import { describe, expect, it } from "vitest";
import { distinctEvents, horizonLabel, priceAt, reactionBucket, reactionStats, readHlCandles, type Candle } from "./reaction";

const STEP = 15 * 60_000;
const T0 = Date.UTC(2026, 9, 1);

/** Candles every 15 minutes whose open follows `price(i)`. */
function candles(count: number, price: (index: number) => number): Candle[] {
  return Array.from({ length: count }, (_, index) => ({ t: T0 + index * STEP, o: price(index), c: price(index + 1) }));
}

describe("news reaction", () => {
  it("merges news bursts into one event", () => {
    const minute = 60_000;
    expect(distinctEvents([T0 + 90 * minute, T0, T0 + 10 * minute, T0 + 59 * minute, T0 + 200 * minute])).toEqual([
      T0,
      T0 + 90 * minute,
      T0 + 200 * minute,
    ]);
  });

  it("finds the candle that contains a time", () => {
    const list = candles(4, (index) => 100 + index);
    expect(priceAt(list, T0, STEP)).toBe(100);
    expect(priceAt(list, T0 + STEP + 1, STEP)).toBe(101);
    expect(priceAt(list, T0 + 4 * STEP, STEP)).toBeNull();
    expect(priceAt(list, T0 - 1, STEP)).toBeNull();
  });

  it("measures the move per horizon and skips horizons that haven't ended", () => {
    // +1% per 15 minutes for 2 days.
    const list = candles(192, (index) => 100 * 1.01 ** index);
    const stats = reactionStats([T0, T0 + 60 * 60_000], list, STEP, [60, 1440, 2880]);
    expect(stats[0]).toMatchObject({ horizonMin: 60, count: 2, upShare: 1 });
    expect(stats[0].avgAbsPct).toBeCloseTo((1.01 ** 4 - 1) * 100, 6);
    expect(stats[1].count).toBe(2);
    expect(stats[2].count).toBe(0);
  });

  it("counts falls and medians", () => {
    const list = candles(20, (index) => (index < 8 ? 100 : 90));
    const [stats] = reactionStats([T0, T0 + 5 * STEP], list, STEP, [60]);
    expect(stats).toMatchObject({ count: 2, upShare: 0 });
    expect(stats.medianPct).toBeCloseTo(-5, 6);
  });

  it("reads Hyperliquid candles and buckets scores", () => {
    expect(readHlCandles([{ t: 2, o: "2", c: "3" }, { t: 1, o: "1", c: "2" }, { t: 3, o: "x", c: "1" }])).toEqual([
      { t: 1, o: 1, c: 2 },
      { t: 2, o: 2, c: 3 },
    ]);
    expect([45, 60, 79, 92].map(reactionBucket)).toEqual([40, 60, 60, 80]);
    expect([60, 240, 1440, 15].map(horizonLabel)).toEqual(["1h", "4h", "24h", "15m"]);
  });
});
