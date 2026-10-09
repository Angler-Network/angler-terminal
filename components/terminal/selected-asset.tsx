"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { ASSET_SYMBOL } from "@/lib/markets/model";
import type { PerpVenueId } from "@/lib/venues/types";

interface SelectedAssetValue {
  symbol: string;
  /** Solana mint for the asset when the source (e.g. a news item) provided one. */
  mint?: string;
  /**
   * The swap venue the pick came from when the asset has several (TSLA: Solana's TSLAx or Arcus's TSLA on Robinhood):
   * a search row of the Arcus filter opens the swap card on Arcus instead of the first venue (Solana).
   */
  spotVenue?: "arcus";
  selectAsset: (symbol: string, mint?: string, spotVenue?: "arcus") => void;
  /** Symbol the news feed is narrowed to (picked from the ticker tape), or null. */
  newsFocus: string | null;
  /** Selects the asset in the chart and narrows the news feed to it. */
  focusAsset: (symbol: string) => void;
  clearNewsFocus: () => void;
  /** Perp venue the order panel is on (picked or routed), or null for spot; the chart follows it on "auto". */
  tradeVenue: PerpVenueId | null;
  setTradeVenue: (venue: PerpVenueId | null) => void;
  /** Swap venue the swap card is on, or null when no swap card shows; the account card lists only its balances. */
  swapVenue: SwapVenue | null;
  setSwapVenue: (venue: SwapVenue | null) => void;
  /** A perp venue picked outside the terminal (the home search); the order panel switches to it once, then clears it. */
  perpVenueRequest: PerpVenueId | null;
  requestPerpVenue: (venue: PerpVenueId | null) => void;
}

export type SwapVenue = "solana" | "arcus";

const SelectedAssetContext = createContext<SelectedAssetValue | null>(null);

export function useSelectedAsset() {
  const context = useContext(SelectedAssetContext);
  if (!context) throw new Error("useSelectedAsset must be used within SelectedAssetProvider");
  return context;
}

/** The asset the chart, order panel and positions bar are focused on. Persisted as the chartSymbol preference. */
export function SelectedAssetProvider({ children }: { children: React.ReactNode }) {
  const { preferences, updatePreference } = usePreferences();
  const symbol = preferences.chartSymbol;
  const [mintFor, setMintFor] = useState<{ symbol: string; mint?: string; spotVenue?: "arcus" } | null>(null);
  const selectAsset = useCallback(
    (next: string, mint?: string, spotVenue?: "arcus") => {
      const clean = next.toUpperCase();
      if (!ASSET_SYMBOL.test(clean)) return;
      updatePreference("chartSymbol", clean);
      setMintFor(mint || spotVenue ? { symbol: clean, mint, spotVenue } : null);
    },
    [updatePreference],
  );
  const mint = mintFor?.symbol === symbol ? mintFor.mint : undefined;
  const spotVenue = mintFor?.symbol === symbol ? mintFor.spotVenue : undefined;
  const [newsFocus, setNewsFocus] = useState<string | null>(null);
  const focusAsset = useCallback(
    (next: string) => {
      selectAsset(next);
      setNewsFocus(next.toUpperCase());
    },
    [selectAsset],
  );
  const clearNewsFocus = useCallback(() => setNewsFocus(null), []);
  const [tradeVenue, setTradeVenue] = useState<PerpVenueId | null>(null);
  const [swapVenue, setSwapVenue] = useState<SwapVenue | null>(null);
  const [perpVenueRequest, requestPerpVenue] = useState<PerpVenueId | null>(null);
  const value = useMemo(
    () => ({ symbol, mint, spotVenue, selectAsset, newsFocus, focusAsset, clearNewsFocus, tradeVenue, setTradeVenue, swapVenue, setSwapVenue, perpVenueRequest, requestPerpVenue }),
    [symbol, mint, spotVenue, selectAsset, newsFocus, focusAsset, clearNewsFocus, tradeVenue, swapVenue, perpVenueRequest],
  );
  return <SelectedAssetContext.Provider value={value}>{children}</SelectedAssetContext.Provider>;
}
