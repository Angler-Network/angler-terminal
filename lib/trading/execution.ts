import type { BookLevel, BookSide } from "./orderbook";

/**
 * Best-execution estimates: walk each venue's order book for a USD size, add the taker fee and compare. Pure,
 * unit-tested. Estimates only: books move and fills can differ.
 */

/** Hyperliquid's base-tier taker fee (0.045%); higher volume tiers pay less. */
export const HL_BASE_TAKER_FEE = 0.00045;

export interface FillEstimate {
  avgPx: number;
  base: number;
  /** False when the book is too thin for the whole size. */
  complete: boolean;
}

/** Fills `notionalUsd` against `levels` (asks for a buy, bids for a sell), best price first. */
export function estimateFill(levels: BookLevel[], notionalUsd: number): FillEstimate | null {
  if (!(notionalUsd > 0) || levels.length === 0) return null;
  let remaining = notionalUsd;
  let base = 0;
  let spent = 0;
  for (const level of levels) {
    const levelUsd = level.price * level.size;
    const take = Math.min(remaining, levelUsd);
    base += take / level.price;
    spent += take;
    remaining -= take;
    if (remaining <= 1e-9) break;
  }
  if (base === 0) return null;
  return { avgPx: spent / base, base, complete: remaining <= 1e-9 };
}

export interface VenueQuoteInput<V extends string> {
  venue: V;
  book: BookSide;
  /** Fraction of notional, all fees the taker pays (venue + builder/integrator). */
  takerFee: number;
}

export interface VenueQuote<V extends string> {
  venue: V;
  avgPx: number;
  /** Best price in the book walked (best ask for a buy, best bid for a sell): the slippage reference. */
  topPx: number;
  feeUsd: number;
  /** Price after fees: what a buy effectively pays per unit, or a sell effectively receives. */
  effectivePx: number;
  complete: boolean;
  /** Extra cost vs the best venue in USD (0 for the best). */
  costVsBestUsd: number;
}

/** Quotes every venue for the same side and USD size, best first (complete fills ahead of partial ones). */
export function compareExecution<V extends string>(side: "buy" | "sell", notionalUsd: number, venues: VenueQuoteInput<V>[]): VenueQuote<V>[] {
  const quotes = venues.flatMap((input) => {
    const levels = side === "buy" ? input.book.asks : input.book.bids;
    const fill = estimateFill(levels, notionalUsd);
    if (!fill) return [];
    const effectivePx = side === "buy" ? fill.avgPx * (1 + input.takerFee) : fill.avgPx * (1 - input.takerFee);
    return [{ venue: input.venue, avgPx: fill.avgPx, topPx: levels[0].price, feeUsd: notionalUsd * input.takerFee, effectivePx, complete: fill.complete, costVsBestUsd: 0 }];
  });
  const better = (a: VenueQuote<V>, b: VenueQuote<V>) =>
    a.complete !== b.complete ? (a.complete ? -1 : 1) : side === "buy" ? a.effectivePx - b.effectivePx : b.effectivePx - a.effectivePx;
  quotes.sort(better);
  const best = quotes[0];
  if (!best) return [];
  // Same base amount on every venue: the cost gap is the effective price gap times the base bought or sold.
  const base = notionalUsd / best.avgPx;
  return quotes.map((quote) => ({ ...quote, costVsBestUsd: Math.abs(quote.effectivePx - best.effectivePx) * base }));
}

/** Lighter `orderBookOrders` (individual orders) aggregated into price levels, best first. */
export function readLighterRestBook(body: unknown): BookSide {
  const record = (body ?? {}) as { asks?: unknown; bids?: unknown };
  const side = (rows: unknown, order: 1 | -1) => {
    const levels = new Map<number, number>();
    for (const row of Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []) {
      const price = Number(row.price);
      const size = Number(row.remaining_base_amount);
      if (price > 0 && size > 0) levels.set(price, (levels.get(price) ?? 0) + size);
    }
    return [...levels].map(([price, size]) => ({ price, size })).sort((a, b) => order * (a.price - b.price));
  };
  return { asks: side(record.asks, 1), bids: side(record.bids, -1) };
}

export interface SplitLeg<V extends string> {
  venue: V;
  usd: number;
  base: number;
  avgPx: number;
}

export interface SplitPlan<V extends string> {
  legs: SplitLeg<V>[];
  /** Price after fees over the whole order. */
  effectivePx: number;
  complete: boolean;
  /** What the split saves vs sending everything to the best single venue, in USD (positive = cheaper). */
  savingsUsd: number;
}

/**
 * Splits one market order across venues: takes the cheapest levels of all books after each venue's taker fee until
 * the USD size is filled. Null when one venue would get everything, when a leg would fall below its venue's
 * minimum (`minUsd`), or when there is no single-venue quote to compare with.
 */
export function splitExecution<V extends string>(
  side: "buy" | "sell",
  notionalUsd: number,
  venues: Array<VenueQuoteInput<V> & { minUsd?: number }>,
): SplitPlan<V> | null {
  if (!(notionalUsd > 0) || venues.length < 2) return null;
  const levels = venues.flatMap((input) =>
    (side === "buy" ? input.book.asks : input.book.bids).map((level) => ({
      venue: input.venue,
      fee: input.takerFee,
      price: level.price,
      size: level.size,
      effective: side === "buy" ? level.price * (1 + input.takerFee) : level.price * (1 - input.takerFee),
    })),
  );
  levels.sort((a, b) => (side === "buy" ? a.effective - b.effective : b.effective - a.effective));
  const legs = new Map<V, { usd: number; base: number; feeUsd: number }>();
  let remaining = notionalUsd;
  for (const level of levels) {
    if (remaining <= 1e-9) break;
    const take = Math.min(remaining, level.price * level.size);
    const leg = legs.get(level.venue) ?? { usd: 0, base: 0, feeUsd: 0 };
    leg.usd += take;
    leg.base += take / level.price;
    leg.feeUsd += take * level.fee;
    legs.set(level.venue, leg);
    remaining -= take;
  }
  if (legs.size < 2) return null;
  for (const input of venues) {
    const leg = legs.get(input.venue);
    if (leg && input.minUsd && leg.usd < input.minUsd) return null;
  }
  const base = [...legs.values()].reduce((sum, leg) => sum + leg.base, 0);
  const spent = [...legs.values()].reduce((sum, leg) => sum + leg.usd, 0);
  const fees = [...legs.values()].reduce((sum, leg) => sum + leg.feeUsd, 0);
  const effectivePx = side === "buy" ? (spent + fees) / base : (spent - fees) / base;
  const single = compareExecution(side, notionalUsd, venues)[0];
  if (!single) return null;
  const savingsUsd = (side === "buy" ? single.effectivePx - effectivePx : effectivePx - single.effectivePx) * base;
  return {
    legs: [...legs].map(([venue, leg]) => ({ venue, usd: leg.usd, base: leg.base, avgPx: leg.usd / leg.base })).sort((a, b) => b.usd - a.usd),
    effectivePx,
    complete: remaining <= 1e-9,
    savingsUsd,
  };
}
