import { describe, expect, it } from "vitest";
import { fittingIntervalCount, quickIntervals } from "./interval-fit";

describe("interval fit", () => {
  it("keeps every starred interval when there is room", () => {
    expect(quickIntervals(["5m", "15m", "1h", "4h"], "1h")).toEqual(["5m", "15m", "1h", "4h"]);
    expect(quickIntervals(["5m", "1h"], "1d", 3)).toEqual(["5m", "1h", "1d"]);
  });

  it("always keeps the active interval when slots run out", () => {
    expect(quickIntervals(["5m", "15m", "1h", "4h"], "4h", 1)).toEqual(["4h"]);
    expect(quickIntervals(["5m", "15m", "1h", "4h"], "1h", 2)).toEqual(["5m", "1h"]);
  });

  it("counts the buttons that fit, never fewer than one", () => {
    expect(fittingIntervalCount(0)).toBe(1);
    expect(fittingIntervalCount(30 + 42 * 3)).toBe(3);
    expect(fittingIntervalCount(30 + 42 * 3 - 1)).toBe(2);
  });
});
