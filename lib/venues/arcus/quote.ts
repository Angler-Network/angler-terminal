/** Arcus quote handling: picks the gasless arcus route and checks price impact. Pure, unit-tested. */

export const ARCUS_ERROR_MESSAGES: Record<string, string> = {
  TRADE_NOTIONAL_BELOW_MINIMUM: "Arcus needs at least $5 per trade.",
  NO_QUOTES: "Arcus has no quote for this token right now. Try again in a moment.",
  RATE_LIMITED: "Arcus is rate limiting requests. Wait a moment and try again.",
  SLIPPAGE_EXCEEDED: "The price moved past the slippage limit, so the swap didn't go through.",
  INSUFFICIENT_BALANCE: "Not enough balance for this trade.",
  API_KEY_ORIGIN_FORBIDDEN: "Arcus refused this site's origin.",
};

export function arcusErrorMessage(code: string | undefined, fallback: string) {
  return (code && ARCUS_ERROR_MESSAGES[code]) || fallback;
}

/**
 * Price impact in percent (positive is worse) of a fill against the router's reference price. The reference is in
 * human units of buy token per sell token for the quoted direction; null when the router has none (testnet).
 */
export function arcusPriceImpactPct(
  quote: { sellAmount: bigint; buyAmount: bigint },
  decimals: { sell: number; buy: number },
  referencePrice: number | null,
) {
  if (!referencePrice || !(referencePrice > 0) || quote.sellAmount <= 0n) return null;
  const sold = Number(quote.sellAmount) / 10 ** decimals.sell;
  const bought = Number(quote.buyAmount) / 10 ** decimals.buy;
  return ((referencePrice - bought / sold) / referencePrice) * 100;
}

export function readReferencePrice(body: unknown) {
  const value = Number((body as { referencePrice?: unknown } | null)?.referencePrice);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The arcus-venue firm quote: it settles gasless through the relayer, unlike the other venues' user-sent txs. */
export function pickArcusQuote<Q extends { venue: string }>(body: unknown): Q | null {
  const all = (body as { all?: unknown } | null)?.all;
  if (!Array.isArray(all)) return null;
  return (all.find((quote) => quote && (quote as Q).venue === "arcus") as Q | undefined) ?? null;
}

/** USD price of one token from an indicative quote that spent `spendUsd` of the stablecoin; null without a fill. */
export function indicativeTokenPrice(spendUsd: number, buyAmount: string | bigint | undefined, decimals: number) {
  if (buyAmount === undefined) return null;
  let units: bigint;
  try {
    units = BigInt(buyAmount);
  } catch {
    return null;
  }
  const tokens = Number(units) / 10 ** decimals;
  return tokens > 0 ? spendUsd / tokens : null;
}
