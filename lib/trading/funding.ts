/**
 * Funding rates across venues from Lighter's aggregated `funding-rates` endpoint plus Aster's and Orderly's own (mainnet, merged by
 * /api/funding): one rate per venue and
 * symbol, normalized to 8 hours (Hyperliquid's hourly 0.0000125 shows as 0.0001). Pure, unit-tested.
 */

export const FUNDING_VENUES = ["hyperliquid", "lighter", "lighterRh", "aster", "orderly", "binance", "bybit"] as const;
/** The funding feed's venue for a perp venue (Lighter RH's rates come from its own feed, `/api/funding`). */
export function fundingVenueOf(venue: string): FundingVenue | null {
  return venue === "hyperliquid" || venue === "lighter" || venue === "lighterRh" || venue === "aster" || venue === "orderly" ? venue : null;
}

export type FundingVenue = (typeof FUNDING_VENUES)[number];
/** Venues the terminal can trade, so arbitrage suggestions stay actionable. */
export const TRADABLE_FUNDING_VENUES: FundingVenue[] = ["hyperliquid", "lighter"];

export type FundingTable = Record<string, Partial<Record<FundingVenue, number>>>;

export function readFundingRates(body: unknown): FundingTable {
  const rows = (body as { funding_rates?: unknown } | null)?.funding_rates;
  const table: FundingTable = {};
  for (const row of Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []) {
    const venue = row.exchange as FundingVenue;
    const symbol = typeof row.symbol === "string" ? row.symbol.toUpperCase() : "";
    const rate = Number(row.rate);
    if (!FUNDING_VENUES.includes(venue) || !symbol || !Number.isFinite(rate)) continue;
    (table[symbol] ??= {})[venue] = rate;
  }
  return table;
}

/** 8-hour rate → annualized percent (3 periods a day). */
export function fundingApr(rate8h: number) {
  return rate8h * 3 * 365 * 100;
}

export interface FundingArb {
  /** Long here: it has the lowest funding, so longs pay the least (or get paid). */
  longVenue: FundingVenue;
  /** Short here: the highest funding, so shorts collect the most. */
  shortVenue: FundingVenue;
  /** Annualized percent collected by holding both legs, before fees and price differences. */
  apr: number;
}

export function bestFundingArb(rates: Partial<Record<FundingVenue, number>>, venues: FundingVenue[] = TRADABLE_FUNDING_VENUES): FundingArb | null {
  const listed = venues.flatMap((venue) => (rates[venue] === undefined ? [] : [{ venue, rate: rates[venue]! }]));
  if (listed.length < 2) return null;
  listed.sort((a, b) => a.rate - b.rate);
  const low = listed[0];
  const high = listed[listed.length - 1];
  if (high.rate === low.rate) return null;
  return { longVenue: low.venue, shortVenue: high.venue, apr: fundingApr(high.rate - low.rate) };
}

/**
 * Base size for both legs of a delta-neutral position: the same amount on each venue, rounded down to the coarser of
 * the two size steps so neither venue rounds it differently.
 */
export function arbLegSize(notionalUsd: number, price: number, szDecimals: number[]) {
  if (!(notionalUsd > 0) || !(price > 0) || szDecimals.length === 0) return 0;
  const decimals = Math.min(...szDecimals);
  const factor = 10 ** decimals;
  return Math.floor((notionalUsd / price) * factor + 1e-9) / factor;
}

/** Funding collected per day by holding both legs of `notionalUsd` each, at today's 8-hour rates. */
export function dailyArbFunding(notionalUsd: number, arb: Pick<FundingArb, "apr">) {
  return (notionalUsd * arb.apr) / 100 / 365;
}
