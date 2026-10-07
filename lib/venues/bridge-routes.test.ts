import { describe, expect, it } from "vitest";
import { fundsKind, fundsRoute, presetRoute } from "./bridge-routes";

const mainnet = () => "mainnet" as const;
const testnet = () => "testnet" as const;

describe("fundsRoute", () => {
  it("deposits from the wallet into any perp venue", () => {
    expect(fundsRoute("wallet", "lighter", mainnet)).toMatchObject({ kind: "deposit", venue: "lighter", plan: { kind: "transfer", target: "intent" } });
    expect(fundsRoute("wallet", "hyperliquid", testnet)).toMatchObject({ kind: "deposit", plan: { kind: "faucet" } });
    expect(fundsRoute("wallet", "aster", mainnet)).toEqual({ kind: "soon" });
  });

  it("withdraws from Hyperliquid only", () => {
    expect(fundsRoute("hyperliquid", "wallet", mainnet)).toEqual({ kind: "withdraw", venue: "hyperliquid" });
    expect(fundsRoute("lighter", "wallet", mainnet)).toEqual({ kind: "soon" });
  });

  it("bridges Hyperliquid → Lighter on mainnet", () => {
    expect(fundsRoute("hyperliquid", "lighter", mainnet)).toEqual({ kind: "move" });
    expect(fundsRoute("hyperliquid", "lighter", testnet)).toEqual({ kind: "testnet" });
    expect(fundsRoute("lighter", "hyperliquid", mainnet)).toEqual({ kind: "soon" });
    expect(fundsRoute("hyperliquid", "aster", mainnet)).toEqual({ kind: "soon" });
    expect(fundsRoute("lighter", "lighter", mainnet)).toEqual({ kind: "same" });
  });

  it("names the flow and starts shortcuts where they work", () => {
    expect(fundsKind(fundsRoute("wallet", "lighterRh", mainnet))).toBe("deposit");
    expect(fundsKind({ kind: "soon" })).toBeNull();
    expect(presetRoute("deposit", "lighterRh")).toEqual({ from: "wallet", to: "lighterRh" });
    expect(presetRoute("withdraw", "lighter")).toEqual({ from: "hyperliquid", to: "wallet" });
    expect(presetRoute("move", "lighter")).toEqual({ from: "hyperliquid", to: "lighter" });
  });
});
