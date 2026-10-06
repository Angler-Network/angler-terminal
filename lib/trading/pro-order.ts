import type { OrderSide, PerpVenueId, VenueMarket } from "@/lib/venues/types";

/**
 * Pro order: several market orders sent at once, on any perp venue and coin (multi), or the same coin long on one
 * venue and short on another (hedge, delta neutral: volume and points without price exposure). Pure, unit-tested.
 */
export interface ProLeg {
  id: number;
  venue: PerpVenueId;
  symbol: string;
  side: OrderSide;
  usd: number;
  leverage: number;
}

export const MAX_PRO_LEGS = 8;

export interface LegPlan {
  leg: ProLeg;
  market: VenueMarket | null;
  /** Base size sent to the venue (0 when it can't be sized). */
  size: number;
  leverage: number;
  /** Why this leg can't be sent, or null. */
  problem: string | null;
}

function priceOf(market: VenueMarket) {
  return market.midPx ?? market.markPx ?? 0;
}

/** Truncates to the size decimals (never rounds up past the USD the user typed). */
export function baseSize(usd: number, price: number, szDecimals: number) {
  if (!(usd > 0) || !(price > 0)) return 0;
  const factor = 10 ** szDecimals;
  return Math.floor((usd / price) * factor + 1e-9) / factor;
}

/**
 * Sizes each leg on its market; `minUsd` is the venue's smallest order. A hedge passes `sharedDecimals` so both legs
 * get the same base size (the coarser step of the two venues).
 */
export function planLegs(
  legs: ProLeg[],
  marketFor: (venue: PerpVenueId, symbol: string) => VenueMarket | null,
  minUsd: (market: VenueMarket) => number,
  sharedDecimals?: number,
): LegPlan[] {
  return legs.map((leg) => {
    const market = marketFor(leg.venue, leg.symbol);
    if (!market) return { leg, market, size: 0, leverage: 1, problem: `${leg.symbol} isn't listed on this venue` };
    const price = priceOf(market);
    const size = baseSize(leg.usd, price, sharedDecimals ?? market.szDecimals);
    const leverage = Math.max(1, Math.min(Math.round(leg.leverage), market.maxLeverage));
    const minimum = minUsd(market);
    const problem = !(leg.usd > 0)
      ? "Enter a size"
      : !(price > 0)
        ? "No price yet"
        : size <= 0 || size * price < minimum
          ? `Minimum is about $${Math.ceil(minimum)}`
          : null;
    return { leg, market, size, leverage, problem };
  });
}

/** The two legs of a hedge: long on one venue, short on the other, same coin and size. */
export function hedgeLegs(symbol: string, longVenue: PerpVenueId, shortVenue: PerpVenueId, usd: number, leverage: number): ProLeg[] {
  return [
    { id: 1, venue: longVenue, symbol, side: "buy", usd, leverage },
    { id: 2, venue: shortVenue, symbol, side: "sell", usd, leverage },
  ];
}
