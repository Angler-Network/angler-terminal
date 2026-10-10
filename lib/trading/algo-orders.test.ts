import { describe, expect, it } from "vitest";
import {
  afterSlice,
  crossingLegs,
  ladderAverage,
  nextSliceSize,
  scaleLadder,
  sliceDue,
  twapPlan,
  TWAP_MAX_FAILURES,
  type TwapJob,
} from "./algo-orders";

const ladder = (overrides: Partial<Parameters<typeof scaleLadder>[0]> = {}) =>
  scaleLadder({ totalSize: 1, from: 100, to: 90, count: 5, distribution: "even", szDecimals: 3, minUsd: 10, ...overrides });

describe("scaleLadder", () => {
  it("spreads even orders across both prices", () => {
    const { legs, error } = ladder();
    expect(error).toBeNull();
    expect(legs.map((leg) => leg.price)).toEqual([100, 97.5, 95, 92.5, 90]);
    expect(legs.every((leg) => leg.size === 0.2)).toBe(true);
    expect(ladderAverage(legs)).toBeCloseTo(95);
  });

  it("grows the orders toward the far price or the near one", () => {
    const up = ladder({ distribution: "up" }).legs.map((leg) => leg.size);
    expect(up).toEqual([0.066, 0.133, 0.2, 0.266, 0.333]);
    const down = ladder({ distribution: "down" }).legs.map((leg) => leg.size);
    expect(down).toEqual([0.333, 0.266, 0.2, 0.133, 0.066]);
  });

  it("never rounds up past the lot", () => {
    const { legs } = ladder({ totalSize: 1, count: 3, szDecimals: 2 });
    expect(legs.reduce((sum, leg) => sum + leg.size, 0)).toBeLessThanOrEqual(1);
  });

  it("refuses orders under the venue minimum", () => {
    expect(ladder({ totalSize: 0.3, count: 5 }).error).toMatch(/at least \$10/);
  });

  it("checks the inputs", () => {
    expect(ladder({ to: 100 }).error).toMatch(/differ/);
    expect(ladder({ count: 1 }).error).toMatch(/2 to 20/);
    expect(ladder({ count: 21 }).error).toMatch(/2 to 20/);
    expect(ladder({ from: 0 }).error).toMatch(/both prices/);
    expect(ladder({ totalSize: 0 })).toEqual({ legs: [], error: null });
  });

  it("counts legs that would fill at once", () => {
    const { legs } = ladder({ from: 102, to: 94 });
    expect(crossingLegs(legs, "buy", 100)).toBe(1);
    expect(crossingLegs(legs, "sell", 100)).toBe(3);
    expect(crossingLegs(legs, "buy", undefined)).toBe(0);
  });
});

describe("twapPlan", () => {
  it("slices every 30s when the size allows it", () => {
    expect(twapPlan({ totalUsd: 10_000, minutes: 10, minUsd: 10 })).toEqual({ slices: 20, intervalMs: 30_000, sliceUsd: 500, error: null });
  });

  it("uses fewer slices when each would fall under the minimum", () => {
    const plan = twapPlan({ totalUsd: 100, minutes: 60, minUsd: 10 });
    expect(plan.slices).toBe(10);
    expect(plan.intervalMs).toBe(360_000);
  });

  it("needs two slices and a duration in range", () => {
    expect(twapPlan({ totalUsd: 15, minutes: 10, minUsd: 10 }).error).toMatch(/\$20/);
    expect(twapPlan({ totalUsd: 1000, minutes: 4, minUsd: 10 }).error).toMatch(/5 minutes/);
    expect(twapPlan({ totalUsd: 1000, minutes: 1441, minUsd: 10 }).error).toMatch(/24 hours/);
  });
});

const job = (overrides: Partial<TwapJob> = {}): TwapJob => ({
  id: "t1",
  venue: "hyperliquid",
  symbol: "BTC",
  side: "buy",
  totalSize: 1,
  szDecimals: 4,
  slices: 4,
  intervalMs: 60_000,
  randomize: false,
  reduceOnly: false,
  leverage: 3,
  isCross: true,
  createdAt: 0,
  nextAt: 0,
  done: 0,
  filledSize: 0,
  filledNotional: 0,
  failures: 0,
  status: "running",
  ...overrides,
});

describe("TWAP jobs", () => {
  it("fills slice by slice and finishes with the remainder", () => {
    let current = job();
    expect(nextSliceSize(current)).toBe(0.25);
    for (let index = 0; index < 3; index++) current = afterSlice(current, { size: nextSliceSize(current), price: 100 }, 1000 * index);
    expect(current.status).toBe("running");
    expect(nextSliceSize(current)).toBe(0.25);
    current = afterSlice(current, { size: 0.25, price: 104 }, 5000);
    expect(current.status).toBe("done");
    expect(current.filledNotional / current.filledSize).toBeCloseTo(101);
  });

  it("moves a failed slice's share to the next ones", () => {
    const failed = afterSlice(job(), null, 0, 0.5, "No margin");
    expect(failed.failures).toBe(1);
    expect(failed.status).toBe("running");
    expect(nextSliceSize(failed)).toBeCloseTo(0.3333, 4);
  });

  it("stops after three failures in a row and resets the count on a fill", () => {
    let current = job({ slices: 10 });
    current = afterSlice(current, null, 0);
    current = afterSlice(current, { size: 0.1, price: 100 }, 0);
    expect(current.failures).toBe(0);
    for (let index = 0; index < TWAP_MAX_FAILURES; index++) current = afterSlice(current, null, 0, 0.5, "Insufficient margin");
    expect(current.status).toBe("failed");
    expect(current.error).toBe("Insufficient margin");
  });

  it("schedules the next slice, with jitter when random timing is on", () => {
    expect(afterSlice(job(), { size: 0.25, price: 1 }, 1000).nextAt).toBe(61_000);
    expect(afterSlice(job({ randomize: true }), { size: 0.25, price: 1 }, 1000, 1).nextAt).toBe(73_000);
    expect(afterSlice(job({ randomize: true }), { size: 0.25, price: 1 }, 1000, 0).nextAt).toBe(49_000);
  });

  it("is due only while running", () => {
    expect(sliceDue(job({ nextAt: 10 }), 10)).toBe(true);
    expect(sliceDue(job({ nextAt: 10 }), 9)).toBe(false);
    expect(sliceDue(job({ nextAt: 0, status: "paused" }), 10)).toBe(false);
  });
});
