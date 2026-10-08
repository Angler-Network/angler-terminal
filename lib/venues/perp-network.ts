import { asterConfig } from "./aster/config";
import { hlConfig } from "./hyperliquid/config";
import { lighterConfigs } from "./lighter/config";
import type { PerpVenueId } from "./types";

/** The network a perp venue trades on in this build (Hyperliquid and Lighter can be testnet; Aster is mainnet). */
export function perpNetwork(venue: PerpVenueId): "mainnet" | "testnet" {
  if (venue === "hyperliquid") return hlConfig.network;
  if (venue === "aster") return asterConfig.network;
  return lighterConfigs[venue].network;
}
