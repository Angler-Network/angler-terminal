import type { SpotQuote } from "@/lib/venues/types";

/**
 * The spot quote to execute: among executable quotes for the same swap, the one with the most output. Jupiter is
 * listed first, so it wins ties.
 */
export function pickBestSpotQuote<Q extends Pick<SpotQuote, "outAmount" | "transaction" | "error">>(quotes: Array<Q | null>): Q | null {
  let best: Q | null = null;
  for (const quote of quotes) {
    if (!quote || !quote.transaction || quote.error) continue;
    if (!best || quote.outAmount > best.outAmount) best = quote;
  }
  return best;
}
