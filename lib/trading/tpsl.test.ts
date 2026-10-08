import { describe, expect, it } from "vitest";
import { optionalPrice, percentFrom, pnlAt, portionOf, tpslError } from "./tpsl";

describe("tpslError", () => {
  it("accepts levels on the right side of the entry", () => {
    expect(tpslError({ side: "buy", reference: 100, takeProfit: 110, stopLoss: 95 })).toBeNull();
    expect(tpslError({ side: "sell", reference: 100, takeProfit: 90, stopLoss: 105 })).toBeNull();
    expect(tpslError({ side: "buy", reference: 100 })).toBeNull();
  });

  it("rejects levels on the wrong side or non-positive", () => {
    expect(tpslError({ side: "buy", reference: 100, takeProfit: 99 })).toMatch(/above/);
    expect(tpslError({ side: "buy", reference: 100, stopLoss: 101 })).toMatch(/below/);
    expect(tpslError({ side: "sell", reference: 100, takeProfit: 101 })).toMatch(/below/);
    expect(tpslError({ side: "sell", reference: 100, stopLoss: 99 })).toMatch(/above/);
    expect(tpslError({ side: "buy", reference: 100, stopLoss: Number.NaN })).toMatch(/positive/);
  });
});

describe("helpers", () => {
  it("computes PnL, percent moves and optional inputs", () => {
    expect(pnlAt("buy", 100, 110, 2)).toBe(20);
    expect(pnlAt("sell", 100, 110, 2)).toBe(-20);
    expect(percentFrom(100, 95)).toBe(-5);
    expect(optionalPrice("")).toBeUndefined();
    expect(optionalPrice(" 12.5 ")).toBe(12.5);
    expect(optionalPrice("abc")).toBeNaN();
  });
});

describe("portionOf", () => {
  it("rounds a partial size down to the lot", () => {
    expect(portionOf(1.2345, 50, 3)).toBe(0.617);
    expect(portionOf(10, 25, 0)).toBe(2);
    expect(portionOf(0.3, 10, 2)).toBe(0.03);
  });

  it("keeps the whole size at 100% and drops sizes below one lot", () => {
    expect(portionOf(1.2345, 100, 3)).toBe(1.2345);
    expect(portionOf(0.001, 25, 3)).toBeUndefined();
  });
});
