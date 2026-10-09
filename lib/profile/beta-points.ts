/**
 * Closed beta points event: trades placed during the closed beta earn BETA_POINTS_MULTIPLIER (`levels.ts`) times their
 * points. What counts is the trade's own time (fill, trade, swap block, Orderly day), not when a sync credits it, so a
 * profile synced after the beta opened still gets the bonus for its beta trades and none for later ones. One event:
 * from BETA_POINTS_SINCE (the admin closed beta switch shipped) until the beta first opens (`ended`, recorded once by
 * `setClosedBeta`); closing the beta again doesn't restart it. Pure, unit-tested.
 */

/** When the admin closed beta switch shipped: the beta (closed while unset) counts for bonus points from here. */
export const BETA_POINTS_SINCE = Date.parse("2026-10-09T12:32:23Z");

const DAY_MS = 86_400_000;

/** The event's span, [start, end), end Infinity while it runs; null where there's none (testnet). */
export type BetaWindow = { start: number; end: number } | null;

/** The event's span given when the beta opened (`ended`, ms as stored; unset while it's still closed). */
export function betaWindow(ended: unknown, since = BETA_POINTS_SINCE): BetaWindow {
  const end = ended === null || ended === undefined || ended === "" ? Infinity : Number(ended);
  if (Number.isNaN(end)) return { start: since, end: Infinity };
  return end > since ? { start: since, end } : null;
}

/** Whether a trade at `time` (ms) was placed during the event. */
export function inBeta(window: BetaWindow, time: number) {
  return window !== null && time >= window.start && time < window.end;
}

/** Whether any of the UTC day starting at `dayStart` fell in the event (Orderly reports volume per day). */
export function dayInBeta(window: BetaWindow, dayStart: number) {
  return window !== null && window.start < dayStart + DAY_MS && window.end > dayStart;
}
