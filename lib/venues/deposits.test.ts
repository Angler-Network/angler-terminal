import { describe, expect, it } from "vitest";
import { depositError, depositPlan, fromTokenUnits, moveError, tokenUnits, usdcUnits, withdrawalArrived } from "./deposits";

describe("deposit plans", () => {
  it("bridges on mainnet and points testnets to faucets", () => {
    expect(depositPlan("hyperliquid", "mainnet")).toMatchObject({ kind: "transfer", target: "bridge", sources: [{ chainId: 42161 }] });
    const lighter = depositPlan("lighter", "mainnet");
    expect(lighter.kind === "transfer" && lighter.sources.map((source) => source.name)).toEqual(["Arbitrum", "Base"]);
    expect(depositPlan("hyperliquid", "testnet")).toMatchObject({ kind: "faucet", url: "https://app.hyperliquid-testnet.xyz/drip" });
  });

  it("sends USDG on Robinhood Chain to Lighter RH, 1 USDG minimum", () => {
    expect(depositPlan("lighterRh", "mainnet")).toMatchObject({
      kind: "transfer",
      target: "intent",
      minimum: 1,
      sources: [{ chainId: 4663, symbol: "USDG", usdc: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" }],
    });
    expect(depositPlan("lighterRh", "testnet")).toMatchObject({ kind: "transfer", sources: [{ chainId: 46630 }] });
    expect(depositError(usdcUnits("0.5"), null, 1, "USDG")).toBe("The minimum deposit is 1 USDG.");
    expect(depositError(usdcUnits("2"), 1_000_000n, 1, "USDG")).toBe("Not enough USDG in your wallet on this chain.");
  });
});

describe("amounts", () => {
  it("parses USDC amounts and enforces the minimum and balance", () => {
    expect(usdcUnits("12.5")).toBe(12_500_000n);
    expect(usdcUnits("1.1234567")).toBeNull();
    expect(usdcUnits("abc")).toBeNull();
    expect(depositError(usdcUnits("4.99"), null)).toMatch(/minimum/);
    expect(depositError(usdcUnits("10"), 5_000_000n)).toMatch(/Not enough/);
    expect(depositError(usdcUnits("10"), 20_000_000n)).toBeNull();
  });
});

describe("moving Hyperliquid to Lighter", () => {
  it("needs room for the fee and the deposit minimum", () => {
    expect(moveError(5.5, 100)).toMatch(/at least 6/);
    expect(moveError(50, 20)).toMatch(/can withdraw/);
    expect(moveError(20, 50)).toBeNull();
  });

  it("detects the withdrawal arriving in the wallet", () => {
    expect(withdrawalArrived(10_000_000n, 28_900_000n, 19_000_000n)).toBe(true);
    expect(withdrawalArrived(10_000_000n, 15_000_000n, 19_000_000n)).toBe(false);
  });
});

describe("token units", () => {
  it("parses at any decimals and refuses more digits than the token has", () => {
    expect(tokenUnits("1.5", 18)).toBe(1_500_000_000_000_000_000n);
    expect(tokenUnits("2.1234567", 6)).toBeNull();
    expect(usdcUnits("3")).toBe(3_000_000n);
    expect(tokenUnits("abc", 6)).toBeNull();
    expect(fromTokenUnits(250_000_000_000_000_000_000n, 18)).toBe(250);
  });
});

