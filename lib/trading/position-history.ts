/**
 * Closed positions rebuilt from fills (positions bar → Position history): no venue lists them, so fills are replayed
 * per venue and asset from flat to flat. Pure, unit-tested.
 */
import type { PerpVenueId } from "@/lib/venues/types";
import type { HistoryFill } from "./portfolio-history";

export interface ClosedPosition {
  id: string;
  venue: PerpVenueId;
  symbol: string;
  side: "long" | "short";
  /** Largest size the position reached (base units). */
  size: number;
  /** Average entry; null when it opened before the fetched window. */
  entryPrice: number | null;
  exitPrice: number;
  openedAt: number | null;
  closedAt: number;
  /** Realized PnL: the venue's figure when it reports one (Hyperliquid), else exit vs average entry. */
  pnl: number | null;
  /** Fees paid; null when the venue doesn't report them per fill (Lighter). */
  fees: number | null;
}

interface Open {
  side: 1 | -1;
  /** Signed size now. */
  size: number;
  maxSize: number;
  openedAt: number | null;
  /** Entry from fills seen in the window; unknown when part of the position predates it. */
  entryQty: number;
  entryNotional: number;
  entryKnown: boolean;
  exitQty: number;
  exitNotional: number;
  pnl: number;
  pnlKnown: boolean;
  fees: number;
  feesKnown: boolean;
}

const EPSILON = 1e-9;
const isFlat = (size: number, scale: number) => Math.abs(size) <= EPSILON * Math.max(1, scale);

function start(size: number, time: number | null, entryKnown: boolean, price: number): Open {
  const qty = Math.abs(size);
  return {
    side: size > 0 ? 1 : -1,
    size,
    maxSize: qty,
    openedAt: time,
    entryQty: entryKnown ? qty : 0,
    entryNotional: entryKnown ? qty * price : 0,
    entryKnown,
    exitQty: 0,
    exitNotional: 0,
    pnl: 0,
    pnlKnown: true,
    fees: 0,
    feesKnown: true,
  };
}

function close(open: Open, venue: PerpVenueId, symbol: string, time: number, index: number): ClosedPosition {
  const entry = open.entryKnown && open.entryQty > 0 ? open.entryNotional / open.entryQty : null;
  const exit = open.exitQty > 0 ? open.exitNotional / open.exitQty : 0;
  return {
    id: `${venue}:${symbol}:${time}:${index}`,
    venue,
    symbol,
    side: open.side === 1 ? "long" : "short",
    size: clean(open.maxSize),
    entryPrice: entry === null ? null : clean(entry),
    exitPrice: clean(exit),
    openedAt: open.openedAt,
    closedAt: time,
    pnl: open.pnlKnown ? clean(open.pnl) : null,
    fees: open.feesKnown ? clean(open.fees) : null,
  };
}

/** Floating sums leave noise (22.799999999999983): keep 12 significant digits. */
const clean = (value: number) => Number(value.toPrecision(12));

/**
 * Positions closed within the fills' window, newest first. The size at the window start comes from the first fill's
 * `startPosition` when the venue reports it (exact even when the venue cut the window short), else from `current`
 * (each venue's open size per symbol now, signed) minus everything the window's fills added.
 */
export function positionHistory(fills: HistoryFill[], current: Array<{ venue: PerpVenueId; symbol: string; size: number }>): ClosedPosition[] {
  const groups = new Map<string, HistoryFill[]>();
  for (const fill of fills) {
    const key = `${fill.venue}|${fill.symbol}`;
    groups.set(key, [...(groups.get(key) ?? []), fill]);
  }
  const closed: ClosedPosition[] = [];
  for (const [key, group] of groups) {
    const [venue, symbol] = key.split("|") as [PerpVenueId, string];
    group.sort((a, b) => a.time - b.time);
    const now = current.find((position) => position.venue === venue && position.symbol === symbol)?.size ?? 0;
    const traded = group.reduce((sum, fill) => sum + (fill.side === "buy" ? fill.size : -fill.size), 0);
    const scale = Math.max(...group.map((fill) => fill.size), Math.abs(now));
    const seed = group[0].startPosition ?? now - traded;
    let open: Open | null = isFlat(seed, scale) ? null : start(seed, null, false, 0);
    // A position that predates the window reports no PnL or fees for its earlier part.
    if (open) open.pnlKnown = open.feesKnown = venue === "hyperliquid";

    group.forEach((fill, index) => {
      let delta = fill.side === "buy" ? fill.size : -fill.size;
      if (!open) {
        open = start(delta, fill.time, true, fill.price);
        if (fill.fee === null) open.feesKnown = false;
        else open.fees += fill.fee;
        return;
      }
      if (fill.fee === null) open.feesKnown = false;
      else open.fees += fill.fee;
      if (Math.sign(delta) === open.side) {
        open.size += delta;
        open.maxSize = Math.max(open.maxSize, Math.abs(open.size));
        if (open.entryKnown) {
          open.entryQty += Math.abs(delta);
          open.entryNotional += Math.abs(delta) * fill.price;
        }
        return;
      }
      // Reducing: close up to the open size; anything beyond flips into a new position at the same price.
      const closing = Math.min(Math.abs(delta), Math.abs(open.size));
      open.exitQty += closing;
      open.exitNotional += closing * fill.price;
      if (fill.realizedPnl !== null) open.pnl += fill.realizedPnl;
      else if (open.entryKnown && open.entryQty > 0) open.pnl += (fill.price - open.entryNotional / open.entryQty) * closing * open.side;
      else open.pnlKnown = false;
      open.size += Math.sign(delta) * closing;
      delta += -Math.sign(delta) * closing;
      if (isFlat(open.size, scale)) {
        closed.push(close(open, venue, symbol, fill.time, index));
        open = isFlat(delta, scale) ? null : start(delta, fill.time, true, fill.price);
      }
    });
  }
  return closed.sort((a, b) => b.closedAt - a.closedAt);
}
