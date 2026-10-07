import { describe, expect, it } from "vitest";
import {
  MAX_CLIENT_ORDER_INDEX,
  baseAmountFor,
  leverageFraction,
  leverageFromPercent,
  minimumSize,
  isAnglerClientIndex,
  nextClientOrderIndex,
  sizeForNotional,
  toUnits,
  worstPrice,
} from "./pricing";

describe("integer units", () => {
  it("scales without float noise", () => {
    expect(toUnits(0.29, 2, "floor")).toBe(29);
    expect(toUnits(1.005, 3, "ceil")).toBe(1005);
    expect(toUnits(3100, 2)).toBe(310000);
    expect(toUnits(0.0123456, 4, "floor")).toBe(123);
    expect(toUnits(0.0123456, 4, "ceil")).toBe(124);
  });

  it("truncates sizes to the size decimals", () => {
    expect(baseAmountFor(0.05, 4)).toBe(500);
    expect(baseAmountFor(0.123456, 3)).toBe(123);
    expect(baseAmountFor(0.0004, 3)).toBe(0);
    expect(() => baseAmountFor(-1, 3)).toThrow();
  });

  it("rounds the worst price away from the market", () => {
    // Buy: best ask 119.823 + 3% = 123.41769 → up to 123.418.
    expect(worstPrice(119.823, true, 0.03, 3)).toBe(123418);
    // Sell: best bid 119.783 - 3% = 116.18951 → down to 116.189.
    expect(worstPrice(119.783, false, 0.03, 3)).toBe(116189);
    expect(worstPrice(85733, true, 0.03, 1)).toBe(883050);
  });

  it("refuses prices the signer can't encode", () => {
    expect(() => worstPrice(0, true, 0.03, 2)).toThrow();
    expect(() => worstPrice(1e8, true, 0.03, 2)).toThrow(/too large/);
    expect(() => worstPrice(0.001, false, 0.9, 2)).toThrow(/zero/);
  });
});

describe("sizes", () => {
  const sol = { szDecimals: 3, minBaseAmount: 0.05, minQuoteAmount: 10 };

  it("applies the larger of the base and quote minimum", () => {
    // $10 at $120 = 0.0834 SOL > 0.05 SOL → rounded up to 0.084.
    expect(minimumSize(sol, 120)).toBe(0.084);
    // At $1000, $10 is 0.01 SOL < 0.05.
    expect(minimumSize(sol, 1000)).toBe(0.05);
  });

  it("sizes a USD notional", () => {
    expect(sizeForNotional(25, 119.857, 3)).toBe(0.208);
    expect(sizeForNotional(0, 100, 3)).toBe(0);
    expect(sizeForNotional(10, 0, 3)).toBe(0);
  });
});

describe("leverage", () => {
  it("converts to and from margin fractions", () => {
    expect(leverageFraction(10)).toBe(1000);
    expect(leverageFraction(3)).toBe(3333);
    expect(() => leverageFraction(0)).toThrow();
    expect(leverageFromPercent("5.00")).toBe(20);
    expect(leverageFromPercent("6.66")).toBe(15);
    expect(leverageFromPercent(undefined)).toBe(1);
  });
});

describe("client order index", () => {
  it("increases strictly and stays within 48 bits", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    const first = nextClientOrderIndex(now, 0);
    const second = nextClientOrderIndex(now, first);
    expect(second).toBeGreaterThan(first);
    expect(nextClientOrderIndex(now + 1000, second)).toBeGreaterThan(second);
    // Older pages used milliseconds × 64; the new indexes stay above them.
    expect(first).toBeGreaterThan(now * 64);
    for (const index of [first, second, nextClientOrderIndex(now, 5e13 + 3)]) expect(isAnglerClientIndex(index)).toBe(true);
    expect(isAnglerClientIndex(now * 64)).toBe(false);
    expect(isAnglerClientIndex(0)).toBe(false);
    // Eleven orders in one second stay unique and tagged.
    let last = 0;
    for (let count = 0; count < 11; count++) {
      const next = nextClientOrderIndex(now, last);
      expect(next).toBeGreaterThan(last);
      expect(isAnglerClientIndex(next)).toBe(true);
      last = next;
    }
    expect(first).toBeLessThanOrEqual(MAX_CLIENT_ORDER_INDEX);
    expect(() => nextClientOrderIndex(Date.parse("2120-01-01T00:00:00Z"), 0)).toThrow();
  });
});
