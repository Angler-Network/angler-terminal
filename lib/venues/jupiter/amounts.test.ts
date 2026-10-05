import { describe, expect, it } from "vitest";
import { fromBaseUnits, toBaseUnits, usdToInputAmount } from "./amounts";

describe("toBaseUnits", () => {
  it("uses the token's decimals", () => {
    expect(toBaseUnits(1.5, 6)).toBe(1_500_000n); // USDC
    expect(toBaseUnits("0.000000001", 9)).toBe(1n); // 1 lamport
    expect(toBaseUnits(2, 0)).toBe(2n);
  });

  it("rounds down instead of up", () => {
    expect(toBaseUnits(0.1234569, 6)).toBe(123_456n);
  });

  it("rejects bad input", () => {
    expect(() => toBaseUnits(-1, 6)).toThrow(RangeError);
    expect(() => toBaseUnits(1, 1.5)).toThrow(RangeError);
  });
});

describe("fromBaseUnits", () => {
  it("converts back for display", () => {
    expect(fromBaseUnits(1_500_000n, 6)).toBe(1.5);
    expect(fromBaseUnits(5n, 9)).toBe(0.000000005);
    expect(fromBaseUnits(7n, 0)).toBe(7);
  });
});

describe("usdToInputAmount", () => {
  const usdc = { decimals: 6, usdPrice: 1 };
  const sol = { decimals: 9, usdPrice: 150 };
  const bonk = { decimals: 5, usdPrice: 0.00002 };

  it("buys with USDC: the input is the USD size in USDC units", () => {
    expect(usdToInputAmount(2, "buy", usdc, sol)).toBe(2_000_000n);
  });

  it("sells the token: the input is USD / price in token units", () => {
    expect(usdToInputAmount(3, "sell", usdc, sol)).toBe(20_000_000n); // 0.02 SOL
    expect(usdToInputAmount(1, "sell", usdc, bonk)).toBe(5_000_000_000n); // 50,000 BONK at 5 decimals
  });

  it("returns zero for empty sizes and needs a price to sell", () => {
    expect(usdToInputAmount(0, "buy", usdc, sol)).toBe(0n);
    expect(() => usdToInputAmount(1, "sell", usdc, { decimals: 6 })).toThrow(RangeError);
  });
});
