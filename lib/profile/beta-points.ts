/**
 * Closed beta points event: trades placed while the closed beta is on earn BETA_POINTS_MULTIPLIER (`levels.ts`) times
 * their points. What counts is the trade's own time (fill, trade, swap block, Orderly day), not when a sync credits it,
 * so a profile synced after the beta opened still gets the bonus for its beta trades and none for later ones. The
 * event starts at BETA_POINTS_SINCE (the admin closed beta switch shipped) and follows the switch's history: opening the
 * beta ends it, closing it again starts it again. Pure, unit-tested.
 */

/** When the admin closed beta switch shipped: the beta (closed while unset) counts for bonus points from here. */
export const BETA_POINTS_SINCE = Date.parse("2026-10-09T12:32:23Z");

const DAY_MS = 86_400_000;

/** One flip of the closed beta switch. */
export interface BetaSwitch {
  at: number;
  closed: boolean;
}

/** A stretch the beta was closed: [start, end), end Infinity while it still is. */
export type BetaWindow = [start: number, end: number];

/** Switch log entries as stored (`"<ms>:<1|0>"`, 1 = closed); others are skipped. */
export function readBetaLog(entries: unknown): BetaSwitch[] {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    const match = /^(\d+):([01])$/.exec(String(entry));
    return match ? [{ at: Number(match[1]), closed: match[2] === "1" }] : [];
  });
}

/** The stretches the beta was closed from `since` on. Before any flip the beta counts as closed (unset = closed). */
export function betaWindows(log: BetaSwitch[], since = BETA_POINTS_SINCE): BetaWindow[] {
  const sorted = log.filter((entry) => Number.isFinite(entry.at)).sort((a, b) => a.at - b.at);
  let closed = true;
  for (const entry of sorted) if (entry.at <= since) closed = entry.closed;
  const windows: BetaWindow[] = [];
  let start: number | null = closed ? since : null;
  for (const entry of sorted) {
    if (entry.at <= since) continue;
    if (entry.closed && start === null) start = entry.at;
    else if (!entry.closed && start !== null) {
      windows.push([start, entry.at]);
      start = null;
    }
  }
  if (start !== null) windows.push([start, Infinity]);
  return windows;
}

/** Whether a trade at `time` (ms) was placed during the closed beta. */
export function inBeta(windows: BetaWindow[], time: number) {
  return windows.some(([start, end]) => time >= start && time < end);
}

/** Whether any of the UTC day starting at `dayStart` fell in the closed beta (Orderly reports volume per day). */
export function dayInBeta(windows: BetaWindow[], dayStart: number) {
  return windows.some(([start, end]) => start < dayStart + DAY_MS && end > dayStart);
}
