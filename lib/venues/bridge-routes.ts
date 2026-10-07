import { depositPlan, type DepositPlan } from "./deposits";
import type { PerpVenueId } from "./types";

/**
 * The funds window is one sentence: "Move [amount] USDC from [endpoint] to [endpoint]", where an endpoint is the
 * user's wallet or a venue. The pair decides the flow (wallet → venue deposits, venue → wallet withdraws, venue →
 * venue bridges), so a new venue is one entry in BRIDGE_VENUES and a new direction one case in `fundsRoute`.
 * Pure, unit-tested.
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

type Network = "mainnet" | "testnet";

export type FundsRoute =
  | { kind: "same" }
  /** Wallet → venue: an on-chain transfer, or the venue's faucet on testnet. */
  | { kind: "deposit"; venue: PerpVenueId; plan: DepositPlan }
  /** Hyperliquid → wallet on Arbitrum (`withdraw3`). */
  | { kind: "withdraw"; venue: "hyperliquid" }
  /** Hyperliquid → Lighter: withdraw to Arbitrum, then deposit to the wallet's Lighter address. */
  | { kind: "move" }
  /** A direction without a flow yet (or the bridge on testnet, where funds come from faucets). */
  | { kind: "soon" | "testnet" };

const PERP_VENUES = new Set<string>(["hyperliquid", "lighter", "lighterRh"]);

export function isPerpEndpoint(endpoint: FundsEndpoint): endpoint is PerpVenueId {
  return PERP_VENUES.has(endpoint);
}

export function fundsRoute(from: FundsEndpoint, to: FundsEndpoint, networkOf: (venue: PerpVenueId) => Network): FundsRoute {
  if (from === to) return { kind: "same" };
  if (from === "wallet") return isPerpEndpoint(to) ? { kind: "deposit", venue: to, plan: depositPlan(to, networkOf(to)) } : { kind: "soon" };
  if (to === "wallet") return from === "hyperliquid" ? { kind: "withdraw", venue: "hyperliquid" } : { kind: "soon" };
  if (from === "hyperliquid" && to === "lighter") return networkOf("hyperliquid") === "mainnet" && networkOf("lighter") === "mainnet" ? { kind: "move" } : { kind: "testnet" };
  return { kind: "soon" };
}

/** What the route does, for the title and the shortcut tabs; null when it does nothing yet. */
export function fundsKind(route: FundsRoute): FundsKind | null {
  return route.kind === "deposit" || route.kind === "withdraw" || route.kind === "move" ? route.kind : null;
}

/**
 * The route a shortcut tab (or `openDeposit(venue, mode)`) starts on: deposits keep the venue the user is looking
 * at; withdrawals and the bridge start where they work today (Hyperliquid).
 */
export function presetRoute(kind: FundsKind, venue: PerpVenueId): { from: FundsEndpoint; to: FundsEndpoint } {
  if (kind === "deposit") return { from: "wallet", to: venue };
  if (kind === "withdraw") return { from: "hyperliquid", to: "wallet" };
  return { from: "hyperliquid", to: "lighter" };
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
