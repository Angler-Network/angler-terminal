/** Order panel math. Estimates only: the venue's own margin engine has the final word. */

/**
 * Liquidation price of a new isolated position, with Hyperliquid's maintenance rule (half the initial margin at max
 * leverage): liq = entry - side * entry * (1/leverage - mmr) / (1 - side * mmr).
 */
export function estimateLiquidationPrice({
  side,
  entry,
  leverage,
  maxLeverage,
}: {
  side: "buy" | "sell";
  entry: number;
  leverage: number;
  maxLeverage: number;
}) {
  if (!(entry > 0) || !(leverage >= 1) || !(maxLeverage >= 1)) return null;
  const direction = side === "buy" ? 1 : -1;
  const maintenance = 1 / (2 * maxLeverage);
  const buffer = 1 / Math.min(leverage, maxLeverage) - maintenance;
  if (buffer <= 0) return null;
  const price = entry - (direction * entry * buffer) / (1 - direction * maintenance);
  return price > 0 ? price : null;
}

export function marginRequired(notionalUsd: number, leverage: number) {
  return leverage >= 1 ? notionalUsd / leverage : notionalUsd;
}

/** USD order size for a share of the available balance at the chosen leverage (perps) or as is (spot, leverage 1). */
export function sizeFromPercent(availableUsd: number, leverage: number, percent: number) {
  if (!(availableUsd > 0) || !(percent > 0)) return 0;
  // Leave a little room for fees and price moves so 100% doesn't get rejected for insufficient margin.
  const usable = percent >= 100 ? 0.98 : percent / 100;
  return Math.floor(availableUsd * Math.max(1, leverage) * usable * 100) / 100;
}

/** Distance from the mark price to liquidation, in percent of the mark; null without a liquidation price. */
export function liquidationDistancePct(markPx: number | undefined, liquidationPx: number | null) {
  if (!markPx || !(markPx > 0) || !liquidationPx || !(liquidationPx > 0)) return null;
  return (Math.abs(markPx - liquidationPx) / markPx) * 100;
}
