import { describe, expect, it } from "vitest";
import { formatUsdCompact, fundingCountdown, hourlyFundingPct, signedPercent, slippagePct } from "./market-stats";

describe("market stats", () => {
  it("formats compact USD", () => {
    expect(formatUsdCompact(950)).toBe("$950");
    expect(formatUsdCompact(12_345)).toBe("$12.35K");
    expect(formatUsdCompact(4_560_000)).toBe("$4.56M");
    expect(formatUsdCompact(253_000_000)).toBe("$253.0M");
    expect(formatUsdCompact(2_530_000_000)).toBe("$2.53B");
    expect(formatUsdCompact(undefined)).toBe("—");
  });

  it("turns the 8-hour rate into the hourly percent", () => {
    expect(hourlyFundingPct(0.0001)).toBeCloseTo(0.00125);
  });

  it("counts down to the top of the hour", () => {
    expect(fundingCountdown(Date.UTC(2026, 0, 1, 3, 2, 30))).toBe("57:30");
    expect(fundingCountdown(Date.UTC(2026, 0, 1, 3, 0, 0))).toBe("60:00");
  });

  it("signs percents and measures slippage against the mid", () => {
    expect(signedPercent(0.5)).toBe("+0.50%");
    expect(signedPercent(-1.234, 1)).toBe("-1.2%");
    expect(slippagePct("buy", 100, 100.5)).toBeCloseTo(0.5);
    expect(slippagePct("sell", 100, 99.8)).toBeCloseTo(0.2);
    expect(slippagePct("buy", 0, 1)).toBe(0);
  });
});
