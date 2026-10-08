/** Take-profit / stop-loss checks for the order panel and the position TP/SL editor. Pure, unit-tested. */

export interface TpslInput {
  /** Side of the position being protected ("buy" = long). */
  side: "buy" | "sell";
  /** Entry (new order) or mark (open position) price the levels are compared with. */
  reference: number;
  takeProfit?: number;
  stopLoss?: number;
}

/** A readable problem with the levels, or null when they make sense for the side. */
export function tpslError({ side, reference, takeProfit, stopLoss }: TpslInput): string | null {
  if (takeProfit !== undefined && !(takeProfit > 0)) return "Take profit must be a positive price.";
  if (stopLoss !== undefined && !(stopLoss > 0)) return "Stop loss must be a positive price.";
  if (!(reference > 0)) return null;
  const isLong = side === "buy";
  if (takeProfit !== undefined && (isLong ? takeProfit <= reference : takeProfit >= reference)) {
    return `Take profit must be ${isLong ? "above" : "below"} ${isLong ? "the entry for a long" : "the entry for a short"}.`;
  }
  if (stopLoss !== undefined && (isLong ? stopLoss >= reference : stopLoss <= reference)) {
    return `Stop loss must be ${isLong ? "below" : "above"} ${isLong ? "the entry for a long" : "the entry for a short"}.`;
  }
  return null;
}

/** PnL in USD if the position of `size` (base units, unsigned) opened at `entry` closes at `exit`. */
export function pnlAt(side: "buy" | "sell", entry: number, exit: number, size: number) {
  return (side === "buy" ? exit - entry : entry - exit) * size;
}

/** Move from the reference in percent (signed), for the TP/SL hints. */
export function percentFrom(reference: number, price: number) {
  return reference > 0 ? ((price - reference) / reference) * 100 : 0;
}

/** Reads an optional price input: empty means "not set". */
export function optionalPrice(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * `percent` of a position's `size` (base units, unsigned) for a partial close or TP/SL, rounded down to the lot so it
 * never exceeds the position. 100% (or more) is the whole size, unrounded; undefined when nothing is left.
 */
export function portionOf(size: number, percent: number, szDecimals: number) {
  if (percent >= 100) return size;
  const factor = 10 ** szDecimals;
  const portion = Math.floor(((size * percent) / 100) * factor + 1e-9) / factor;
  return portion > 0 ? portion : undefined;
}
