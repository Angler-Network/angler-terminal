"use client";

import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { hlSpotCoin, parseBookSpotRef, pickBookSpotListing } from "@/lib/spot/book-spot";
import { terminalKindOf } from "@/lib/terminal-kind";
import type { VenueMarket } from "@/lib/venues/types";
import { useSelectedAsset } from "./selected-asset";
import { useSpotListings } from "./use-spot-listings";

/**
 * On /spot: the order-book market the view trades, as a `book:<venue>:<id>` ref: the one picked in the search, else
 * the selected asset's busiest Hyperliquid or Lighter spot market. null when neither venue lists the asset (or outside
 * /spot), undefined while the listings load. The order panel, the order book and the chart all follow it.
 */
export function useBookSpotRef(): string | null | undefined {
  const enabled = terminalKindOf(usePathname()) === "book";
  const { symbol, mint } = useSelectedAsset();
  const { preferences } = usePreferences();
  const listings = useSpotListings(enabled && !parseBookSpotRef(mint));
  if (!enabled) return null;
  if (parseBookSpotRef(mint)) return mint!;
  if (!listings) return undefined;
  return pickBookSpotListing(listings, symbol, { hyperliquid: preferences.venueHyperliquid, lighter: preferences.venueLighter })?.address ?? null;
}

/**
 * A book ref as the market shape the order book streams (Hyperliquid by its spot coin, "@107"; Lighter by market id).
 * Tick sizes follow the live mid, so nothing else is needed.
 */
export function useBookVenueMarket(ref: string | null | undefined): VenueMarket | null {
  return useMemo(() => {
    const book = parseBookSpotRef(ref);
    if (!book) return null;
    return {
      venue: book.venue,
      coin: book.venue === "hyperliquid" ? hlSpotCoin(book.id) : String(book.id),
      symbol: ref!,
      dex: "",
      assetId: book.venue === "hyperliquid" ? 10_000 + book.id : book.id,
      szDecimals: 0,
      maxLeverage: 1,
      kind: "crypto",
      onlyIsolated: false,
    };
  }, [ref]);
}
