import { RH_USDG, ROBINHOOD_CHAIN_IDS } from "./lighter/config";
import type { PerpVenueId } from "./types";

/**
 * How USDC gets into each perp venue from the user's EVM wallet. Pure, unit-tested.
 * - Hyperliquid mainnet: native USDC sent on Arbitrum to the Bridge2 contract is credited to the sender in under a
 *   minute (minimum 5 USDC; less is lost). docs: hyperliquid-docs/for-developers/api/usdc.
 * - Lighter mainnet: USDC sent to a CCTP intent address (`/api/v1/createIntentAddress`, per chain and wallet) on
 *   Arbitrum or Base is credited to the wallet's Lighter account (minimum 5 USDC). docs: deposits-transfers-and-withdrawals.
 * - Lighter on Robinhood: USDG sent on Robinhood Chain to its intent address (`createIntentAddress` with
 *   chain_id 4663) is credited to the wallet's account there (minimum 1 USDG). docs: apidocs.rh.lighter.xyz.
 * - Testnets: Hyperliquid and Lighter hand out test USDC from their own apps instead.
 */

export interface SourceChain {
  chainId: number;
  name: string;
  /** The stablecoin sent from this chain (USDC, or USDG on Robinhood Chain). */
  usdc: `0x${string}`;
  symbol: "USDC" | "USDG";
  explorer: string;
}

export const ARBITRUM: SourceChain = {
  chainId: 42161,
  name: "Arbitrum",
  usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  symbol: "USDC",
  explorer: "https://arbiscan.io",
};

export const BASE: SourceChain = {
  chainId: 8453,
  name: "Base",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  symbol: "USDC",
  explorer: "https://basescan.org",
};

export const ROBINHOOD: Record<"mainnet" | "testnet", SourceChain> = {
  mainnet: { chainId: ROBINHOOD_CHAIN_IDS.mainnet, name: "Robinhood Chain", usdc: RH_USDG.mainnet, symbol: "USDG", explorer: "https://explorer.chain.robinhood.com" },
  testnet: {
    chainId: ROBINHOOD_CHAIN_IDS.testnet,
    name: "Robinhood Chain testnet",
    usdc: RH_USDG.testnet,
    symbol: "USDG",
    explorer: "https://explorer.testnet.chain.robinhood.com",
  },
};

export const HL_BRIDGE: `0x${string}` = "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7";
export const MIN_DEPOSIT_USDC = 5;
export const USDC_DECIMALS = 6;

export type DepositPlan =
  | { kind: "transfer"; venue: PerpVenueId; sources: SourceChain[]; arrival: string; target: "bridge" | "intent"; minimum: number }
  | { kind: "faucet"; venue: PerpVenueId; url: string; label: string };

/** Lighter on Robinhood's minimum per deposit, in USDG. */
export const MIN_RH_DEPOSIT_USDG = 1;

export function depositPlan(venue: PerpVenueId, network: "mainnet" | "testnet"): DepositPlan {
  // Lighter on Robinhood has no faucet: even testnet takes (test) USDG from Robinhood Chain.
  if (venue === "lighterRh") return { kind: "transfer", venue, sources: [ROBINHOOD[network]], arrival: "a few minutes", target: "intent", minimum: MIN_RH_DEPOSIT_USDG };
  if (network === "testnet") {
    return venue === "hyperliquid"
      ? { kind: "faucet", venue, url: "https://app.hyperliquid-testnet.xyz/drip", label: "Claim test USDC on Hyperliquid testnet" }
      : { kind: "faucet", venue, url: "https://testnet.app.lighter.xyz", label: "Get test USDC in the Lighter testnet app" };
  }
  return venue === "hyperliquid"
    ? { kind: "transfer", venue, sources: [ARBITRUM], arrival: "under a minute", target: "bridge", minimum: MIN_DEPOSIT_USDC }
    : { kind: "transfer", venue, sources: [ARBITRUM, BASE], arrival: "a few minutes", target: "intent", minimum: MIN_DEPOSIT_USDC };
}

/** USD amount → USDC base units, rounded down; null when it isn't a valid amount. */
export function usdcUnits(amount: string) {
  if (!/^\d+(\.\d{0,6})?$/.test(amount.trim())) return null;
  const [whole, fraction = ""] = amount.trim().split(".");
  return BigInt(whole + fraction.padEnd(USDC_DECIMALS, "0"));
}

/** Why the amount can't be deposited, or null when it can. */
export function depositError(units: bigint | null, balance: bigint | null, minimum = MIN_DEPOSIT_USDC, symbol = "USDC") {
  if (units === null || units <= 0n) return "Enter an amount.";
  if (units < BigInt(minimum) * 10n ** BigInt(USDC_DECIMALS)) return `The minimum deposit is ${minimum} ${symbol}.`;
  if (balance !== null && units > balance) return `Not enough ${symbol} in your wallet on this chain.`;
  return null;
}

/** Hyperliquid's withdrawal fee, taken from the amount. */
export const HL_WITHDRAW_FEE_USDC = 1;

/**
 * Moving Hyperliquid → Lighter is a Hyperliquid withdrawal (minus its fee) followed by a Lighter deposit, so the
 * amount must leave at least the deposit minimum after the fee and fit what Hyperliquid can withdraw.
 */
export function moveError(amount: number, withdrawable: number | undefined) {
  if (!(amount > 0)) return "Enter an amount.";
  if (amount - HL_WITHDRAW_FEE_USDC < MIN_DEPOSIT_USDC) return `Move at least ${MIN_DEPOSIT_USDC + HL_WITHDRAW_FEE_USDC} USDC (1 USDC withdrawal fee + 5 USDC deposit minimum).`;
  if (withdrawable !== undefined && amount > withdrawable) return "More than Hyperliquid can withdraw right now.";
  return null;
}

/** True once the withdrawal shows up in the wallet (allowing for rounding). */
export function withdrawalArrived(before: bigint, now: bigint, expected: bigint) {
  return now - before >= (expected * 99n) / 100n;
}
