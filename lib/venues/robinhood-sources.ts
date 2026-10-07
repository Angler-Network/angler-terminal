import { venueAvailable } from "@/lib/deployment";
import { arcusConfig } from "./arcus/config";

/**
 * Where Robinhood Chain stock tokens (the Arcus catalog) can be swapped: Arcus's gasless router and, on mainnet, the
 * Uniswap Trading API. Each swap asks every enabled source and takes the larger output.
 */
export type RobinhoodSource = "arcus" | "uniswap";

export const ROBINHOOD_SOURCE_NAMES: Record<RobinhoodSource, string> = { arcus: "Arcus", uniswap: "Uniswap" };

/** Uniswap has no testnet, so it only joins when this build's Robinhood Chain is mainnet. */
export const uniswapOnRobinhood = (available = venueAvailable("uniswap"), network = arcusConfig.network) => available && network === "mainnet";

export function robinhoodSources(preferences: { venueArcus: boolean; venueUniswap: boolean }): RobinhoodSource[] {
  const sources: RobinhoodSource[] = [];
  if (preferences.venueArcus) sources.push("arcus");
  if (preferences.venueUniswap && uniswapOnRobinhood()) sources.push("uniswap");
  return sources;
}
