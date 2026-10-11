import { asterConfig } from "./aster/config";
import { extendedConfig } from "./extended/config";
import { hlConfig } from "./hyperliquid/config";
import { lighterConfigs } from "./lighter/config";
import { orderlyConfig } from "./orderly/config";
import type { PerpVenueId } from "./types";

/** The network a perp venue trades on in this build (Hyperliquid, Lighter and Orderly can be testnet; Aster is mainnet). */
export function perpNetwork(venue: PerpVenueId): "mainnet" | "testnet" {
  if (venue === "hyperliquid") return hlConfig.network;
  if (venue === "aster") return asterConfig.network;
  if (venue === "orderly") return orderlyConfig.network;
  if (venue === "extended") return extendedConfig.network;
  if (venue === "qfex") return "mainnet";
  return lighterConfigs[venue].network;
}
