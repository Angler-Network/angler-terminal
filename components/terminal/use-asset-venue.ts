"use client";

import { usePreferences } from "@/components/app/preferences-provider";
import type { SpotToken, VenueMarket } from "@/lib/venues/types";
import { useTrading } from "./trading-provider";
import { useSpotToken } from "./use-spot-token";

export interface AssetVenues {
  perp: VenueMarket | null;
  spot: SpotToken | null;
  /** Which venue a trade on this asset goes to by default. */
  preferred: "perp" | "spot" | null;
}

/**
 * The venue resolver: Hyperliquid perps when listed, Jupiter spot when a verified Solana token exists. A known
 * mint means the asset is a Solana token, so spot wins. Returns undefined while still resolving.
 */
export function useAssetVenues(symbol: string, mint?: string, options: { needSpot?: boolean } = {}): AssetVenues | undefined {
  const { markets } = useTrading();
  const { preferences } = usePreferences();
  const upper = symbol.toUpperCase();
  // Disabled venues resolve to null, so they never get trade buttons.
  const perp = !preferences.venueHyperliquid
    ? null
    : markets
      ? (markets.find((market) => market.symbol === upper && market.dex === "") ?? markets.find((market) => market.symbol === upper) ?? null)
      : undefined;
  // Skip the token lookup when the perp venue already covers the asset, unless the caller needs both.
  const lookupSpot = preferences.venueJupiter && (Boolean(mint) || options.needSpot === true || perp === null);
  const spot = useSpotToken(symbol, mint, lookupSpot && perp !== undefined);

  if (perp === undefined || (lookupSpot && spot === undefined)) return undefined;
  const spotToken = spot ?? null;
  const preferred = mint && spotToken ? "spot" : perp ? "perp" : spotToken ? "spot" : null;
  return { perp, spot: spotToken, preferred };
}
