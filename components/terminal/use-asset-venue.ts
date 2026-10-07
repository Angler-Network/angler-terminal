"use client";

import { usePreferences } from "@/components/app/preferences-provider";
import { pickPerpMarket } from "@/lib/venues/routing";
import type { ArcusToken } from "@/lib/venues/arcus/tokens";
import type { SpotToken, SpotVenueId, VenueMarket } from "@/lib/venues/types";
import { useTrading } from "./trading-provider";
import { robinhoodSources } from "@/lib/venues/robinhood-sources";
import { useArcusToken } from "./use-arcus-token";
import { useSpotToken } from "./use-spot-token";

export interface AssetVenues {
  /** The perp market trades go to; its `venue` says which perp venue (preferred first, then the fallback). */
  perp: VenueMarket | null;
  spot: SpotToken | null;
  /** Arcus stock token, looked up only when neither perps nor Jupiter cover the asset (or the caller asks). */
  arcus: ArcusToken | null;
  /** Which venue a trade on this asset goes to by default. */
  preferred: "perp" | "spot" | null;
  /** For a spot trade: Jupiter, or Arcus when only Arcus lists the asset. */
  spotVenue?: SpotVenueId;
}

/**
 * The venue resolver: perps on the preferred perp venue (Hyperliquid by default, Lighter as the fallback, or the
 * other way round in Settings) when listed, Jupiter spot when a verified Solana token exists. A known mint means
 * the asset is a Solana token, so spot wins. Stock tokens on Arcus come last. Returns undefined while still resolving.
 */
export function useAssetVenues(
  symbol: string,
  mint?: string,
  options: { needSpot?: boolean; needArcus?: boolean } = {},
): AssetVenues | undefined {
  const { marketsByVenue, perpOrder } = useTrading();
  const { preferences } = usePreferences();
  // Disabled venues are left out of perpOrder, so they never get trade buttons.
  const perp = pickPerpMarket(symbol, marketsByVenue, perpOrder);
  // Skip the token lookup when the perp venue already covers the asset, unless the caller needs both.
  const lookupSpot = preferences.venueJupiter && (Boolean(mint) || options.needSpot === true || perp === null);
  const spot = useSpotToken(symbol, mint, lookupSpot && perp !== undefined);

  const spotResolved = perp !== undefined && !(lookupSpot && spot === undefined);
  const lookupArcus = robinhoodSources(preferences).length > 0 && !mint && spotResolved && (options.needArcus === true || (perp === null && !spot));
  const arcus = useArcusToken(symbol, lookupArcus);

  if (!spotResolved || (lookupArcus && arcus === undefined)) return undefined;
  const spotToken = spot ?? null;
  const arcusToken = arcus ?? null;
  if (mint && spotToken) return { perp, spot: spotToken, arcus: arcusToken, preferred: "spot", spotVenue: "jupiter" };
  if (perp) return { perp, spot: spotToken, arcus: arcusToken, preferred: "perp" };
  if (spotToken) return { perp, spot: spotToken, arcus: arcusToken, preferred: "spot", spotVenue: "jupiter" };
  if (arcusToken) return { perp, spot: null, arcus: arcusToken, preferred: "spot", spotVenue: "arcus" };
  return { perp, spot: null, arcus: null, preferred: null };
}
