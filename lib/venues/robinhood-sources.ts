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

/** How much more Uniswap must pay before it beats Arcus when Arcus is preferred (Arcus volume earns Arcus points). */
export const PREFER_ARCUS_BPS = 50;

/**
 * Quotes best first (no quote last). With `preferArcus`, Arcus leads unless Uniswap's output is more than
 * `PREFER_ARCUS_BPS` larger; without it, the larger output leads and Arcus wins a tie.
 */
export function orderRobinhoodQuotes<Q extends { source: RobinhoodSource; out: bigint | null }>(quotes: Q[], preferArcus: boolean): Q[] {
  const sorted = [...quotes].sort((a, b) => (a.out === null ? 1 : b.out === null ? -1 : a.out === b.out ? (a.source === "arcus" ? -1 : b.source === "arcus" ? 1 : 0) : a.out > b.out ? -1 : 1));
  const arcus = sorted.find((quote) => quote.source === "arcus");
  const leader = sorted[0];
  if (!preferArcus || !arcus || arcus.out === null || leader === arcus || leader.out === null) return sorted;
  if (leader.out * 10_000n > arcus.out * BigInt(10_000 + PREFER_ARCUS_BPS)) return sorted;
  return [arcus, ...sorted.filter((quote) => quote !== arcus)];
}
