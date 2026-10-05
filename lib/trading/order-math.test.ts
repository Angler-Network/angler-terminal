import { describe, expect, it } from "vitest";
import { estimateLiquidationPrice, liquidationDistancePct, marginRequired, sizeFromPercent } from "./order-math";

describe("estimateLiquidationPrice", () => {
  it("puts longs below and shorts above entry, closer at higher leverage", () => {
    const long10 = estimateLiquidationPrice({ side: "buy", entry: 100, leverage: 10, maxLeverage: 50 })!;
    const long40 = estimateLiquidationPrice({ side: "buy", entry: 100, leverage: 40, maxLeverage: 50 })!;
    const short10 = estimateLiquidationPrice({ side: "sell", entry: 100, leverage: 10, maxLeverage: 50 })!;
    // 1/10 - 1/100 = 9% buffer, divided by (1 - 0.01) for longs and (1 + 0.01) for shorts.
    expect(long10).toBeCloseTo(100 - 9 / 0.99, 6);
    expect(short10).toBeCloseTo(100 + 9 / 1.01, 6);
    expect(long40).toBeGreaterThan(long10);
  });

  it("caps leverage at the market maximum and rejects bad input", () => {
    expect(estimateLiquidationPrice({ side: "buy", entry: 100, leverage: 80, maxLeverage: 50 })).toBeCloseTo(
      estimateLiquidationPrice({ side: "buy", entry: 100, leverage: 50, maxLeverage: 50 })!,
    );
    expect(estimateLiquidationPrice({ side: "buy", entry: 0, leverage: 5, maxLeverage: 50 })).toBeNull();
    // 1x long has no liquidation above zero.
    expect(estimateLiquidationPrice({ side: "buy", entry: 100, leverage: 1, maxLeverage: 1 })).toBeNull();
  });
});

describe("sizing", () => {
  it("computes margin and sizes from a share of the balance", () => {
    expect(marginRequired(1000, 10)).toBe(100);
    expect(sizeFromPercent(200, 5, 50)).toBe(500);
    expect(sizeFromPercent(200, 5, 100)).toBe(980);
    expect(sizeFromPercent(0, 5, 50)).toBe(0);
  });

  it("measures the distance to liquidation", () => {
    expect(liquidationDistancePct(100, 90)).toBeCloseTo(10);
    expect(liquidationDistancePct(100, null)).toBeNull();
  });
});
