/**
 * Swap slippage the user picks in the swap card: null is "Auto" (Jupiter's real-time estimate, RTSE; Titan and Arcus
 * keep their own defaults), a number is a fixed tolerance in basis points sent to every venue. Pure, unit-tested.
 */

export const SLIPPAGE_PRESETS_BPS = [50, 100, 300];
export const MIN_SLIPPAGE_BPS = 1;
/** 50%: anything wider is a mistake, not a setting. */
export const MAX_SLIPPAGE_BPS = 5000;

/** A stored or query-string slippage: whole bps within bounds, else null (Auto). */
export function readSlippageBps(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const bps = Math.round(number);
  return bps >= MIN_SLIPPAGE_BPS && bps <= MAX_SLIPPAGE_BPS ? bps : null;
}

/** A typed percentage ("0.5", "3") to bps, or null when it isn't a usable value. */
export function percentToBps(text: string): number | null {
  if (!/^\d*\.?\d+$/.test(text.trim())) return null;
  return readSlippageBps(Number(text) * 100);
}

export function bpsToPercent(bps: number) {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/** A wide tolerance invites sandwich attacks; a tight one fails on fast-moving tokens. */
export function slippageWarning(bps: number | null) {
  if (bps === null) return null;
  if (bps > 500) return "High slippage: you may get a much worse price (and attract sandwich bots).";
  if (bps < 10) return "Very low slippage: the swap may fail if the price moves.";
  return null;
}
