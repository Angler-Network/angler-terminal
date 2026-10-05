/**
 * Funding rates across venues from Lighter's aggregated `funding-rates` endpoint (mainnet): one rate per venue and
 * symbol, normalized to 8 hours (Hyperliquid's hourly 0.0000125 shows as 0.0001). Pure, unit-tested.
 */

export const FUNDING_VENUES = ["hyperliquid", "lighter", "binance", "bybit"] as const;
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
