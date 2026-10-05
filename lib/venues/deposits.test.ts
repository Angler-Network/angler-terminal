import { describe, expect, it } from "vitest";
import { depositError, depositPlan, usdcUnits } from "./deposits";

describe("deposit plans", () => {
  it("bridges on mainnet and points testnets to faucets", () => {
    expect(depositPlan("hyperliquid", "mainnet")).toMatchObject({ kind: "transfer", target: "bridge", sources: [{ chainId: 42161 }] });
    const lighter = depositPlan("lighter", "mainnet");
    expect(lighter.kind === "transfer" && lighter.sources.map((source) => source.name)).toEqual(["Arbitrum", "Base"]);
    expect(depositPlan("hyperliquid", "testnet")).toMatchObject({ kind: "faucet", url: "https://app.hyperliquid-testnet.xyz/drip" });
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
