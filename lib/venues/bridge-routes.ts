/**
 * Venues the Bridge can move USDC between, and which directions work today. A new venue is one entry here; a new
 * direction is one entry in ROUTES plus its steps in the bridge view. Pure, unit-tested.
 */
export const BRIDGE_VENUES = [
  { id: "hyperliquid", name: "Hyperliquid", live: true },
  { id: "lighter", name: "Lighter", live: true },
  { id: "aster", name: "Aster", live: false },
  { id: "orderly", name: "Orderly", live: false },
] as const;

export type BridgeVenueId = (typeof BRIDGE_VENUES)[number]["id"];

/** Directions with a working flow: Hyperliquid withdraws to Arbitrum, then the wallet deposits to Lighter. */
const ROUTES = new Set<string>(["hyperliquid>lighter"]);

export type RouteStatus = "ready" | "same" | "soon";

export function routeStatus(from: BridgeVenueId, to: BridgeVenueId): RouteStatus {
  if (from === to) return "same";
  return ROUTES.has(`${from}>${to}`) ? "ready" : "soon";
}

export function bridgeVenueName(id: BridgeVenueId) {
  return BRIDGE_VENUES.find((venue) => venue.id === id)?.name ?? id;
}
