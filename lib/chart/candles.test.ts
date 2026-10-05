import { describe, expect, it } from "vitest";
import { chartIntervals, intervalDuration, intervalGroups, intervalLabel, intervalShortLabel, isChartInterval } from "./candles";

describe("chart intervals", () => {
  it("groups every interval exactly once, in order", () => {
    expect(intervalGroups.flatMap((group) => group.intervals)).toEqual([...chartIntervals]);
  });

  it("labels intervals", () => {
    expect(intervalLabel("1m")).toBe("1 minute");
    expect(intervalLabel("15m")).toBe("15 minutes");
    expect(intervalLabel("12h")).toBe("12 hours");
    expect(intervalLabel("1M")).toBe("1 month");
    expect(intervalShortLabel("4h")).toBe("4h");
    expect(intervalShortLabel("1d")).toBe("1D");
    expect(intervalShortLabel("1M")).toBe("1M");
  });

  it("knows durations and rejects unknown names", () => {
    expect(intervalDuration("3m")).toBe(180_000);
    expect(intervalDuration("1w")).toBe(7 * 86_400_000);
    expect(isChartInterval("2h")).toBe(true);
    expect(isChartInterval("6h")).toBe(false);
  });
});
