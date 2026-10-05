"use client";

import { usePreferences } from "@/components/app/preferences-provider";
import { pickPerpMarket } from "@/lib/venues/routing";
import type { SpotToken, VenueMarket } from "@/lib/venues/types";
import { useTrading } from "./trading-provider";
import { useSpotToken } from "./use-spot-token";

export interface AssetVenues {
  /** The perp market trades go to; its `venue` says which perp venue (preferred first, then the fallback). */
  perp: VenueMarket | null;
  spot: SpotToken | null;
  /** Which venue a trade on this asset goes to by default. */
  preferred: "perp" | "spot" | null;
}

/**
 * The venue resolver: perps on the preferred perp venue (Hyperliquid by default, Lighter as the fallback, or the
 * other way round in Settings) when listed, Jupiter spot when a verified Solana token exists. A known mint means
 * the asset is a Solana token, so spot wins. Returns undefined while still resolving.
 */
export function useAssetVenues(symbol: string, mint?: string, options: { needSpot?: boolean } = {}): AssetVenues | undefined {
  const { marketsByVenue, perpOrder } = useTrading();
  const { preferences } = usePreferences();
  // Disabled venues are left out of perpOrder, so they never get trade buttons.
  const perp = pickPerpMarket(symbol, marketsByVenue, perpOrder);
  // Skip the token lookup when the perp venue already covers the asset, unless the caller needs both.
  const lookupSpot = preferences.venueJupiter && (Boolean(mint) || options.needSpot === true || perp === null);
  const spot = useSpotToken(symbol, mint, lookupSpot && perp !== undefined);

  if (perp === undefined || (lookupSpot && spot === undefined)) return undefined;
  const spotToken = spot ?? null;
  const preferred = mint && spotToken ? "spot" : perp ? "perp" : spotToken ? "spot" : null;
  return { perp, spot: spotToken, preferred };
}
