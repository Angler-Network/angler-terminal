import { findMarket } from "./hyperliquid/markets";
import type { PerpVenueId, VenueMarket } from "./types";

export const PERP_VENUES: PerpVenueId[] = ["hyperliquid", "lighter", "lighterRh", "aster", "orderly", "extended", "qfex"];

/** "Lighter RH" is Lighter on Robinhood Chain: a separate exchange (own accounts, USDG margin, mostly stock perps). */
export const PERP_VENUE_NAMES: Record<PerpVenueId, string> = { hyperliquid: "Hyperliquid", lighter: "Lighter", lighterRh: "Lighter RH", aster: "Aster", orderly: "Orderly", extended: "Extended", qfex: "QFEX" };

/** Short labels for badges and tight columns. */
export const PERP_VENUE_SHORT: Record<PerpVenueId, string> = { hyperliquid: "HL", lighter: "Lighter", lighterRh: "Lighter RH", aster: "Aster", orderly: "Orderly", extended: "Extended", qfex: "QFEX" };

/** Markets per perp venue: undefined while loading, [] when the venue is off or failed to load. */
export type MarketsByVenue = Partial<Record<PerpVenueId, VenueMarket[] | undefined>>;

/** Enabled perp venues, preferred first. */
export function perpVenueOrder(preferred: PerpVenueId, enabled: Partial<Record<PerpVenueId, boolean>>) {
  return [preferred, ...PERP_VENUES.filter((venue) => venue !== preferred)].filter((venue) => enabled[venue]);
}

/**
 * The perp market a news trade on `symbol` goes to: the preferred venue when it lists the asset, else the next
 * enabled venue that does. Undefined while a venue that could decide is still loading; null when none lists it.
 */
export function pickPerpMarket(symbol: string, markets: MarketsByVenue, order: PerpVenueId[]): VenueMarket | null | undefined {
  for (const venue of order) {
    const list = markets[venue];
    if (list === undefined) return undefined;
    const market = findMarket(list, symbol);
    if (market) return market;
  }
  return null;
}
