import { describe, expect, it } from "vitest";
import { bpsToPercent, percentToBps, readSlippageBps, slippageWarning } from "./slippage";

describe("slippage", () => {
  it("reads stored and query values, null is Auto", () => {
    expect(readSlippageBps(null)).toBeNull();
    expect(readSlippageBps("")).toBeNull();
    expect(readSlippageBps("50")).toBe(50);
    expect(readSlippageBps(49.6)).toBe(50);
    expect(readSlippageBps(0)).toBeNull();
    expect(readSlippageBps(9000)).toBeNull();
    expect(readSlippageBps("abc")).toBeNull();
  });

  it("converts percentages", () => {
    expect(percentToBps("0.5")).toBe(50);
    expect(percentToBps("3")).toBe(300);
    expect(percentToBps(".25")).toBe(25);
    expect(percentToBps("60")).toBeNull();
    expect(percentToBps("1,5")).toBeNull();
    expect(bpsToPercent(50)).toBe("0.5%");
    expect(bpsToPercent(125)).toBe("1.25%");
  });

  it("warns at the extremes", () => {
    expect(slippageWarning(null)).toBeNull();
    expect(slippageWarning(100)).toBeNull();
    expect(slippageWarning(800)).toMatch(/High/);
    expect(slippageWarning(5)).toMatch(/low/);
  });
});
