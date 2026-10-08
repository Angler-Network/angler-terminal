import { ARBITRUM, BASE, ETHEREUM, HL_WITHDRAW_FEE_USDC, MIN_DEPOSIT_USDC, ROBINHOOD, depositPlan, type DepositPlan, type SourceChain } from "./deposits";
import type { LighterVenueId } from "./lighter/config";
import type { PerpVenueId } from "./types";

/**
 * The funds window is one sentence: "Move [amount] [token] from [endpoint] to [endpoint]", where an endpoint is a
 * venue or the user's wallet on a chain (USDC on Arbitrum or Base, USDG on Robinhood Chain). `fundsRoute` turns the
 * pair into steps: a Hyperliquid withdrawal, an Across bridge (which also changes USDC ↔ USDG), a transfer into a
 * venue. A new venue is one entry in BRIDGE_VENUES plus its cases here. Pure, unit-tested.
 */
export const BRIDGE_VENUES = [
  { id: "hyperliquid", name: "Hyperliquid", live: true, domain: "hyperliquid.xyz" },
  { id: "lighter", name: "Lighter", live: true, domain: "lighter.xyz" },
  { id: "lighterRh", name: "Lighter RH", live: true, domain: "lighter.xyz" },
  { id: "aster", name: "Aster", live: false, domain: "asterdex.com" },
  { id: "orderly", name: "Orderly", live: false, domain: "orderly.network" },
] as const;

export type BridgeVenueId = (typeof BRIDGE_VENUES)[number]["id"];
export type FundsEndpoint = "wallet" | BridgeVenueId;
export type FundsKind = "deposit" | "withdraw" | "move";

/** Where the wallet side holds its stablecoin. */
export const WALLET_CHAINS = ["arbitrum", "base", "ethereum", "robinhood"] as const;
export type WalletChain = (typeof WALLET_CHAINS)[number];

type Network = "mainnet" | "testnet";

/** The wallet chain's stablecoin on that network (Arbitrum and Base are mainnet-only here). */
export function walletChainSource(chain: WalletChain, network: Network = "mainnet"): SourceChain {
  return chain === "robinhood" ? ROBINHOOD[network] : chain === "base" ? BASE : chain === "ethereum" ? ETHEREUM : ARBITRUM;
}

export type FundsStep =
  /** Hyperliquid `withdraw3` to the wallet's USDC on Arbitrum, minus the 1 USDC fee. */
  | { kind: "hlWithdraw" }
  /** Across from the wallet on `from` to `to`, paid to the wallet or to a Lighter instance's deposit address. */
  | { kind: "across"; from: SourceChain; to: SourceChain; recipient: "wallet" | LighterVenueId }
  /** A transfer from the wallet into a venue (Hyperliquid's bridge contract or a Lighter deposit address). */
  | { kind: "transfer"; venue: PerpVenueId; source: SourceChain; target: "bridge" | "intent"; minimum: number; arrival: string };

export type FundsRoute =
  | { kind: "same" }
  /** A direction without a flow yet. */
  | { kind: "soon" }
  /** Needs mainnet: Across and the venue-to-venue moves only run there; testnets use faucets. */
  | { kind: "testnet" }
  /** Testnet deposit: the venue's faucet. */
  | { kind: "faucet"; venue: PerpVenueId; plan: Extract<DepositPlan, { kind: "faucet" }> }
  | { kind: "steps"; flow: FundsKind; steps: FundsStep[]; input: SourceChain; output: SourceChain };

const PERP_VENUES = new Set<string>(["hyperliquid", "lighter", "lighterRh"]);

export function isPerpEndpoint(endpoint: FundsEndpoint): endpoint is PerpVenueId {
  return PERP_VENUES.has(endpoint);
}

/** What a venue holds its margin in, and on which chain its deposits land. */
function venueAsset(venue: PerpVenueId): SourceChain {
  return venue === "lighterRh" ? ROBINHOOD.mainnet : ARBITRUM;
}

function transfer(venue: PerpVenueId, plan: Extract<DepositPlan, { kind: "transfer" }>, source: SourceChain): FundsStep {
  return { kind: "transfer", venue, source, target: plan.target, minimum: plan.minimum, arrival: plan.arrival };
}

export function fundsRoute(
  from: FundsEndpoint,
  to: FundsEndpoint,
  chains: { from: WalletChain; to: WalletChain },
  networkOf: (venue: PerpVenueId) => Network,
): FundsRoute {
  if (from === to && (from !== "wallet" || chains.from === chains.to)) return { kind: "same" };
  const steps = (flow: FundsKind, list: FundsStep[], input: SourceChain, output: SourceChain): FundsRoute => ({ kind: "steps", flow, steps: list, input, output });

  if (from === "wallet") {
    const source = walletChainSource(chains.from, isPerpEndpoint(to) ? networkOf(to) : "mainnet");
    if (to === "wallet") {
      const target = walletChainSource(chains.to);
      return steps("move", [{ kind: "across", from: source, to: target, recipient: "wallet" }], source, target);
    }
    // Aster deposits (its depositFor contract on Arbitrum) come with the funds flow for it.
    if (!isPerpEndpoint(to) || to === "aster") return { kind: "soon" };
    const plan = depositPlan(to, networkOf(to));
    if (plan.kind === "faucet") return { kind: "faucet", venue: to, plan };
    const direct = plan.sources.find((entry) => entry.chainId === source.chainId);
    if (direct) return steps("deposit", [transfer(to, plan, direct)], direct, direct);
    if (networkOf(to) !== "mainnet") return { kind: "testnet" };
    const target = venueAsset(to);
    // Hyperliquid credits whoever sends to its bridge, so the USDC lands in the wallet first; Lighter's deposit
    // addresses credit whatever arrives, so Across pays them directly.
    return to === "hyperliquid"
      ? steps("deposit", [{ kind: "across", from: source, to: target, recipient: "wallet" }, transfer(to, plan, target)], source, target)
      : steps("deposit", [{ kind: "across", from: source, to: target, recipient: to }], source, target);
  }

  if (from !== "hyperliquid") return { kind: "soon" };
  const hlMainnet = networkOf("hyperliquid") === "mainnet";
  if (to === "wallet") {
    if (chains.to === "arbitrum") return steps("withdraw", [{ kind: "hlWithdraw" }], ARBITRUM, ARBITRUM);
    if (!hlMainnet) return { kind: "testnet" };
    const target = walletChainSource(chains.to);
    return steps("withdraw", [{ kind: "hlWithdraw" }, { kind: "across", from: ARBITRUM, to: target, recipient: "wallet" }], ARBITRUM, target);
  }
  if (to === "lighter" || to === "lighterRh") {
    if (!hlMainnet || networkOf(to) !== "mainnet") return { kind: "testnet" };
    const plan = depositPlan(to, "mainnet");
    if (plan.kind !== "transfer") return { kind: "testnet" };
    const target = venueAsset(to);
    return to === "lighter"
      ? steps("move", [{ kind: "hlWithdraw" }, transfer(to, plan, ARBITRUM)], ARBITRUM, ARBITRUM)
      : steps("move", [{ kind: "hlWithdraw" }, { kind: "across", from: ARBITRUM, to: target, recipient: to }], ARBITRUM, target);
  }
  return { kind: "soon" };
}

/** What the route does, for the title and the shortcut tabs; null when it does nothing yet. */
export function fundsKind(route: FundsRoute): FundsKind | null {
  return route.kind === "steps" ? route.flow : route.kind === "faucet" ? "deposit" : null;
}

/** The least a venue credits when Across pays it directly (Lighter's deposit minimums). */
export function acrossRecipientMinimum(recipient: "wallet" | LighterVenueId) {
  return recipient === "lighterRh" ? 1 : recipient === "lighter" ? MIN_DEPOSIT_USDC : 0;
}

/**
 * Why the amount can't start this route, before any quote: an amount, Hyperliquid's withdrawal fee and what it can
 * withdraw, the first transfer's minimum. Wallet balances and Across's own limits are checked by the window.
 */
export function stepsError(steps: FundsStep[], amount: number, withdrawable: number | undefined, symbol: string) {
  if (!(amount > 0)) return "Enter an amount.";
  const [first, second] = steps;
  if (first.kind === "hlWithdraw") {
    if (withdrawable !== undefined && amount > withdrawable) return "More than Hyperliquid can withdraw right now.";
    const after = amount - HL_WITHDRAW_FEE_USDC;
    const minimum = second?.kind === "transfer" ? second.minimum : second?.kind === "across" ? Math.max(1, acrossRecipientMinimum(second.recipient)) : 0;
    if (after <= 0 || after < minimum) return `Move at least ${HL_WITHDRAW_FEE_USDC + Math.max(minimum, 1)} USDC (1 USDC withdrawal fee${minimum ? ` + ${minimum} USDC minimum` : ""}).`;
  }
  if (first.kind === "transfer" && amount < first.minimum) return `The minimum deposit is ${first.minimum} ${symbol}.`;
  return null;
}

/**
 * The route a shortcut tab (or `openDeposit(venue, mode)`) starts on: deposits keep the venue the user is looking
 * at, from the chain it takes directly; withdrawals and the bridge start where they work today (Hyperliquid).
 */
export function presetRoute(kind: FundsKind, venue: PerpVenueId): { from: FundsEndpoint; to: FundsEndpoint; chains: { from: WalletChain; to: WalletChain } } {
  if (kind === "deposit") return { from: "wallet", to: venue, chains: { from: venue === "lighterRh" ? "robinhood" : "arbitrum", to: "arbitrum" } };
  if (kind === "withdraw") return { from: "hyperliquid", to: "wallet", chains: { from: "arbitrum", to: "arbitrum" } };
  return { from: "hyperliquid", to: venue === "lighterRh" ? "lighterRh" : "lighter", chains: { from: "arbitrum", to: "arbitrum" } };
}

export function bridgeVenueDomain(id: BridgeVenueId) {
  return BRIDGE_VENUES.find((venue) => venue.id === id)?.domain ?? "";
}

export function bridgeVenueName(id: BridgeVenueId) {
  return BRIDGE_VENUES.find((venue) => venue.id === id)?.name ?? id;
}

export function endpointName(endpoint: FundsEndpoint) {
  return endpoint === "wallet" ? "Wallet" : bridgeVenueName(endpoint);
}

export const WALLET_CHAIN_NAMES: Record<WalletChain, string> = { arbitrum: "Arbitrum", base: "Base", ethereum: "Ethereum", robinhood: "Robinhood Chain" };
