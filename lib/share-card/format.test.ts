import { describe, expect, it } from "vitest";
import { dataLabel, DEFAULT_DATA, normalizeData, signedMoney, signedPercent, type TradeInput } from "./format";

const data = (patch: Partial<Record<keyof TradeInput, unknown>>) => ({ ...DEFAULT_DATA, ...patch }) as TradeInput;

describe("share card format", () => {
  it("signs PnL and ROI unambiguously, with no sign at zero", () => {
    expect(signedMoney(961.54)).toBe("+$961.54");
    expect(signedMoney(-321.75)).toBe("−$321.75");
    expect(signedMoney(0)).toBe("$0.00");
    expect(signedMoney(-0)).toBe("$0.00");
    expect(signedMoney(1234567.8)).toBe("+$1,234,567.80");
    expect(signedPercent(38.46)).toBe("+38.46%");
    expect(signedPercent(-12.87)).toBe("−12.87%");
    expect(signedPercent(0)).toBe("0.00%");
  });

  it("rejects invalid data instead of inventing a trade", () => {
    for (const roi of [NaN, Infinity, undefined, "12"]) expect(() => normalizeData(data({ roi }))).toThrow(TypeError);
    expect(() => normalizeData({} as TradeInput)).toThrow(TypeError);
    expect(() => normalizeData(data({ leverage: 0 }))).toThrow(RangeError);
    expect(() => normalizeData(data({ direction: "buy" }))).toThrow(TypeError);
    expect(() => normalizeData(data({ symbol: "" }))).toThrow(TypeError);
  });

  it("keeps a hidden amount out of the accessible description", () => {
    const d = normalizeData(data({ symbol: " eth ", hidePnl: true, pnl: 23456 }));
    expect(d.symbol).toBe("ETH");
    expect(dataLabel(d)).not.toContain("23,456");
    expect(dataLabel(d)).toContain("PnL hidden");
  });
});
