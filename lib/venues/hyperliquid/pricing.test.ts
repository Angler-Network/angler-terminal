import { describe, expect, it } from "vitest";
import { roundPrice, roundSize, sizeForNotional, slippagePrice, toWire } from "./pricing";

describe("roundPrice", () => {
  it("keeps 5 significant figures", () => {
    expect(roundPrice(97123.456, 5)).toBe(97123);
    expect(roundPrice(1.234567, 1)).toBe(1.2346);
  });

  it("caps decimals at 6 - szDecimals for perps and 8 - szDecimals for spot", () => {
    expect(roundPrice(0.0123456, 2)).toBe(0.0123);
    expect(roundPrice(0.0123456, 2, true)).toBe(0.012346);
  });

  it("allows integer prices beyond 5 significant figures", () => {
    expect(roundPrice(123456, 0)).toBe(123456);
  });

  it("rejects non-positive prices", () => {
    expect(() => roundPrice(0, 2)).toThrow(RangeError);
  });
});

describe("slippagePrice", () => {
  it("pays up to the slippage above mid for buys and below mid for sells", () => {
    expect(slippagePrice(100, true, 0.05, 2)).toBe(105);
    expect(slippagePrice(100, false, 0.05, 2)).toBe(95);
  });

  it("rounds like the official SDK", () => {
    // 3123.45 * 1.05 = 3279.6225 → 5 sig figs → 3279.6
    expect(slippagePrice(3123.45, true, 0.05, 4)).toBe(3279.6);
  });
});

describe("sizes", () => {
  it("truncates to the lot size", () => {
    expect(roundSize(0.123456, 3)).toBe(0.123);
    expect(roundSize(0.3, 1)).toBe(0.3);
  });

  it("converts USD notional to base size", () => {
    expect(sizeForNotional(100, 25_000, 5)).toBe(0.004);
    expect(sizeForNotional(0, 25_000, 5)).toBe(0);
  });

  it("formats wire numbers without exponents or trailing zeros", () => {
    expect(toWire(0.0000123)).toBe("0.0000123");
    expect(toWire(105)).toBe("105");
    expect(toWire(1.5)).toBe("1.5");
  });
});
