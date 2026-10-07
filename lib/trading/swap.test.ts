import { describe, expect, it } from "vitest";
import { estimateReceive, shareOf, swapSizeUsd } from "./swap";

describe("swap math", () => {
  it("sizes buys at par and sells at the asset price", () => {
    expect(swapSizeUsd("buy", 25, 140)).toBe(25);
    expect(swapSizeUsd("sell", 0.5, 140)).toBe(70);
    expect(swapSizeUsd("sell", 0.5, undefined)).toBe(0);
    expect(swapSizeUsd("buy", 0, 140)).toBe(0);
  });

  it("estimates the other side from the price", () => {
    expect(estimateReceive("buy", 28, 140)).toBeCloseTo(0.2);
    expect(estimateReceive("sell", 0.2, 140)).toBeCloseTo(28);
    expect(estimateReceive("buy", 28, undefined)).toBeNull();
  });

  it("takes a share of the balance rounded down", () => {
    expect(shareOf(109.2, 25)).toBe("27.3");
    expect(shareOf(0.123456789, 100, 9)).toBe("0.12345678");
    expect(shareOf(10, 50, 2)).toBe("5");
    expect(shareOf(0, 50)).toBe("");
  });
});
