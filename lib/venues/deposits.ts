import type { PerpVenueId } from "./types";

/**
 * How USDC gets into each perp venue from the user's EVM wallet. Pure, unit-tested.
 * - Hyperliquid mainnet: native USDC sent on Arbitrum to the Bridge2 contract is credited to the sender in under a
 *   minute (minimum 5 USDC; less is lost). docs: hyperliquid-docs/for-developers/api/usdc.
 * - Lighter mainnet: USDC sent to a CCTP intent address (`/api/v1/createIntentAddress`, per chain and wallet) on
 *   Arbitrum or Base is credited to the wallet's Lighter account (minimum 5 USDC). docs: deposits-transfers-and-withdrawals.
 * - Testnets: both venues hand out test USDC from their own apps instead.
 */

export interface SourceChain {
  chainId: number;
  name: string;
  usdc: `0x${string}`;
  explorer: string;
}

export const ARBITRUM: SourceChain = {
  chainId: 42161,
  name: "Arbitrum",
  usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  explorer: "https://arbiscan.io",
};

export const BASE: SourceChain = {
  chainId: 8453,
  name: "Base",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  explorer: "https://basescan.org",
};

export const HL_BRIDGE: `0x${string}` = "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7";
export const MIN_DEPOSIT_USDC = 5;
export const USDC_DECIMALS = 6;

export type DepositPlan =
  | { kind: "transfer"; venue: PerpVenueId; sources: SourceChain[]; arrival: string; target: "bridge" | "intent" }
  | { kind: "faucet"; venue: PerpVenueId; url: string; label: string };

export function depositPlan(venue: PerpVenueId, network: "mainnet" | "testnet"): DepositPlan {
  if (network === "testnet") {
    return venue === "hyperliquid"
      ? { kind: "faucet", venue, url: "https://app.hyperliquid-testnet.xyz/drip", label: "Claim test USDC on Hyperliquid testnet" }
      : { kind: "faucet", venue, url: "https://testnet.app.lighter.xyz", label: "Get test USDC in the Lighter testnet app" };
  }
  return venue === "hyperliquid"
    ? { kind: "transfer", venue, sources: [ARBITRUM], arrival: "under a minute", target: "bridge" }
    : { kind: "transfer", venue, sources: [ARBITRUM, BASE], arrival: "a few minutes", target: "intent" };
}

/** USD amount → USDC base units, rounded down; null when it isn't a valid amount. */
export function usdcUnits(amount: string) {
  if (!/^\d+(\.\d{0,6})?$/.test(amount.trim())) return null;
  const [whole, fraction = ""] = amount.trim().split(".");
  return BigInt(whole + fraction.padEnd(USDC_DECIMALS, "0"));
}

/** Why the amount can't be deposited, or null when it can. */
export function depositError(units: bigint | null, balance: bigint | null) {
  if (units === null || units <= 0n) return "Enter an amount.";
  if (units < BigInt(MIN_DEPOSIT_USDC) * 10n ** BigInt(USDC_DECIMALS)) return `The minimum deposit is ${MIN_DEPOSIT_USDC} USDC.`;
  if (balance !== null && units > balance) return "Not enough USDC in your wallet on this chain.";
  return null;
}
