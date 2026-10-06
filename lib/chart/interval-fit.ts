import { chartIntervals, type ChartInterval } from "./candles";

const byOrder = (a: ChartInterval, b: ChartInterval) => chartIntervals.indexOf(a) - chartIntervals.indexOf(b);

/** Width of one quick interval button plus its gap, and of the dropdown toggle with the group's padding. */
export const QUICK_BUTTON_PX = 42;
export const PICKER_CHROME_PX = 30;

/**
 * Quick interval buttons that fit in `max` slots: the active interval always stays, then the starred ones in order.
 * The rest remain one click away in the dropdown.
 */
export function quickIntervals(favorites: ChartInterval[], active: ChartInterval, max = Infinity) {
  const all = [...new Set([...favorites, active])].sort(byOrder);
  if (all.length <= max) return all;
  const others = all.filter((value) => value !== active).slice(0, Math.max(0, max - 1));
  return [...others, active].sort(byOrder);
}

/** How many quick buttons fit in `availablePx` (at least one, so the active interval is always shown). */
export function fittingIntervalCount(availablePx: number) {
  return Math.max(1, Math.floor((availablePx - PICKER_CHROME_PX) / QUICK_BUTTON_PX));
}
