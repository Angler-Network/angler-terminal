import { describe, expect, it } from "vitest";
import { fundsKind, fundsRoute, presetRoute, stepsError, type FundsRoute, type WalletChain } from "./bridge-routes";

const mainnet = () => "mainnet" as const;
const testnet = () => "testnet" as const;
const on = (from: WalletChain, to: WalletChain = "arbitrum") => ({ from, to });

/** Step kinds, with the chains an Across step crosses and who it pays. */
function shape(route: FundsRoute) {
  if (route.kind !== "steps") return route.kind;
  return route.steps.map((step) =>
    step.kind === "across" ? `across ${step.from.chainId}>${step.to.chainId} ${step.recipient}` : step.kind === "transfer" ? `transfer ${step.venue} ${step.source.chainId}` : step.kind,
  );
}

describe("fundsRoute", () => {
  it("deposits straight from a chain the venue takes", () => {
    expect(shape(fundsRoute("wallet", "lighter", on("base"), mainnet))).toEqual(["transfer lighter 8453"]);
    expect(shape(fundsRoute("wallet", "lighterRh", on("robinhood"), mainnet))).toEqual(["transfer lighterRh 4663"]);
    expect(shape(fundsRoute("wallet", "lighterRh", on("robinhood"), testnet))).toEqual(["transfer lighterRh 46630"]);
    expect(fundsRoute("wallet", "hyperliquid", on("arbitrum"), testnet).kind).toBe("faucet");
  });

  it("bridges other stablecoins in through Across", () => {
    // USDC → USDG straight into Lighter RH's deposit address.
    expect(shape(fundsRoute("wallet", "lighterRh", on("arbitrum"), mainnet))).toEqual(["across 42161>4663 lighterRh"]);
    expect(shape(fundsRoute("wallet", "lighter", on("robinhood"), mainnet))).toEqual(["across 4663>42161 lighter"]);
    // Hyperliquid credits the sender, so the wallet receives first and then deposits.
    expect(shape(fundsRoute("wallet", "hyperliquid", on("base"), mainnet))).toEqual(["across 8453>42161 wallet", "transfer hyperliquid 42161"]);
    expect(shape(fundsRoute("wallet", "lighter", on("ethereum"), mainnet))).toEqual(["across 1>42161 lighter"]);
    // Wallet to wallet across chains: one bridge (the swap card's cross-chain payments).
    expect(shape(fundsRoute("wallet", "wallet", on("ethereum", "base"), mainnet))).toEqual(["across 1>8453 wallet"]);
    expect(shape(fundsRoute("hyperliquid", "wallet", on("arbitrum", "ethereum"), mainnet))).toEqual(["hlWithdraw", "across 42161>1 wallet"]);
    expect(fundsRoute("wallet", "lighterRh", on("arbitrum"), testnet).kind).toBe("testnet");
  });

  it("deposits into Aster through its vault, bridging other chains to Arbitrum first", () => {
    expect(shape(fundsRoute("wallet", "aster", on("arbitrum"), mainnet))).toEqual(["transfer aster 42161"]);
    expect(shape(fundsRoute("wallet", "aster", on("ethereum"), mainnet))).toEqual(["transfer aster 1"]);
    expect(shape(fundsRoute("wallet", "aster", on("base"), mainnet))).toEqual(["across 8453>42161 wallet", "transfer aster 42161"]);
    expect(shape(fundsRoute("hyperliquid", "aster", on("arbitrum"), mainnet))).toEqual(["hlWithdraw", "transfer aster 42161"]);
  });

  it("converts between the wallet's own chains", () => {
    expect(shape(fundsRoute("wallet", "wallet", on("arbitrum", "robinhood"), mainnet))).toEqual(["across 42161>4663 wallet"]);
    expect(fundsRoute("wallet", "wallet", on("base", "base"), mainnet).kind).toBe("same");
  });

  it("moves out of Hyperliquid to any chain or venue", () => {
    expect(shape(fundsRoute("hyperliquid", "wallet", on("arbitrum", "arbitrum"), testnet))).toEqual(["hlWithdraw"]);
    expect(shape(fundsRoute("hyperliquid", "wallet", on("arbitrum", "robinhood"), mainnet))).toEqual(["hlWithdraw", "across 42161>4663 wallet"]);
    expect(shape(fundsRoute("hyperliquid", "lighter", on("arbitrum"), mainnet))).toEqual(["hlWithdraw", "transfer lighter 42161"]);
    expect(shape(fundsRoute("hyperliquid", "lighterRh", on("arbitrum"), mainnet))).toEqual(["hlWithdraw", "across 42161>4663 lighterRh"]);
    expect(fundsRoute("hyperliquid", "lighterRh", on("arbitrum"), testnet).kind).toBe("testnet");
    expect(fundsRoute("lighter", "hyperliquid", on("arbitrum"), mainnet).kind).toBe("soon");
    expect(fundsRoute("lighter", "wallet", on("arbitrum"), mainnet).kind).toBe("soon");
  });

  it("names the flow, checks amounts and presets the shortcuts", () => {
    expect(fundsKind(fundsRoute("wallet", "lighterRh", on("arbitrum"), mainnet))).toBe("deposit");
    expect(fundsKind(fundsRoute("hyperliquid", "lighterRh", on("arbitrum"), mainnet))).toBe("move");
    expect(fundsKind({ kind: "soon" })).toBeNull();

    const toRh = fundsRoute("hyperliquid", "lighterRh", on("arbitrum"), mainnet);
    const toLighter = fundsRoute("hyperliquid", "lighter", on("arbitrum"), mainnet);
    if (toRh.kind !== "steps" || toLighter.kind !== "steps") throw new Error("expected steps");
    expect(stepsError(toRh.steps, 1.5, 100, "USDC")).toMatch(/at least 2 USDC/);
    expect(stepsError(toRh.steps, 3, 100, "USDC")).toBeNull();
    expect(stepsError(toLighter.steps, 5.5, 100, "USDC")).toMatch(/at least 6 USDC/);
    expect(stepsError(toLighter.steps, 50, 20, "USDC")).toBe("More than Hyperliquid can withdraw right now.");

    expect(presetRoute("deposit", "lighterRh")).toEqual({ from: "wallet", to: "lighterRh", chains: { from: "robinhood", to: "arbitrum" } });
    expect(presetRoute("withdraw", "lighter")).toMatchObject({ from: "hyperliquid", to: "wallet" });
    expect(presetRoute("move", "lighterRh")).toMatchObject({ from: "hyperliquid", to: "lighterRh" });
    expect(presetRoute("move", "hyperliquid")).toMatchObject({ from: "hyperliquid", to: "lighter" });
  });
});
