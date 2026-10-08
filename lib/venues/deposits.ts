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

/** Ethereum mainnet: Across bridges USDC to and from it like the L2s (gas costs more there). */
export const ETHEREUM: SourceChain = {
  chainId: 1,
  name: "Ethereum",
  usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  symbol: "USDC",
  explorer: "https://etherscan.io",
};

export const ROBINHOOD: Record<"mainnet" | "testnet", SourceChain> = {
  mainnet: { chainId: ROBINHOOD_CHAIN_IDS.mainnet, name: "Robinhood Chain", usdc: RH_USDG.mainnet, symbol: "USDG", explorer: "https://robinhoodchain.blockscout.com" },
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
  | { kind: "transfer"; venue: PerpVenueId; sources: SourceChain[]; arrival: string; target: "bridge" | "intent" | "aster" | "orderly"; minimum: number }
  | { kind: "faucet"; venue: PerpVenueId; url: string; label: string };

/** Lighter on Robinhood's minimum per deposit, in USDG. */
export const MIN_RH_DEPOSIT_USDG = 1;

/** Aster's deposit vault per chain (its `depositFor` credits the wallet's futures account; docs: demo/aster-deposit-withdrawal.md). */
export const ASTER_VAULTS: Record<number, `0x${string}`> = {
  1: "0x604DD02d620633Ae427888d41bfd15e38483736E",
  42161: "0x9E36CB86a159d479cEd94Fa05036f235Ac40E1d5",
};

export function depositPlan(venue: PerpVenueId, network: "mainnet" | "testnet"): DepositPlan {
  // Aster (mainnet only): USDC from Arbitrum or Ethereum through its vault.
  if (venue === "aster") return { kind: "transfer", venue, sources: [ARBITRUM, ETHEREUM], arrival: "a few minutes", target: "aster", minimum: MIN_DEPOSIT_USDC };
  // Orderly: USDC from Arbitrum or Base through its vault (the same contract on both); testnet points to its testnet app.
  if (venue === "orderly") {
    return network === "mainnet"
      ? { kind: "transfer", venue, sources: [ARBITRUM, BASE], arrival: "a few minutes", target: "orderly", minimum: MIN_DEPOSIT_USDC }
      : { kind: "faucet", venue, url: "https://testnet-dex.orderly.network", label: "Get test USDC in Orderly's testnet app" };
  }
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

/** The wallet chains' stablecoin entries by chain id (mainnet), for flows that start from any of them. */
export function sourceChainById(chainId: number): SourceChain | null {
  return [ARBITRUM, BASE, ETHEREUM, ROBINHOOD.mainnet].find((source) => source.chainId === chainId) ?? null;
}
