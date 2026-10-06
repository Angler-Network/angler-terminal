"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import type { PerpVenueId } from "@/lib/venues/types";

interface SelectedAssetValue {
  symbol: string;
  /** Solana mint for the asset when the source (e.g. a news item) provided one. */
  mint?: string;
  selectAsset: (symbol: string, mint?: string) => void;
  /** Symbol the news feed is narrowed to (picked from the ticker tape), or null. */
  newsFocus: string | null;
  /** Selects the asset in the chart and narrows the news feed to it. */
  focusAsset: (symbol: string) => void;
  clearNewsFocus: () => void;
  /** Perp venue the order panel is on (picked or routed), or null for spot; the chart follows it on "auto". */
  tradeVenue: PerpVenueId | null;
  setTradeVenue: (venue: PerpVenueId | null) => void;
}

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
  const [mintFor, setMintFor] = useState<{ symbol: string; mint: string } | null>(null);
  const selectAsset = useCallback(
    (next: string, mint?: string) => {
      const clean = next.toUpperCase();
      if (!/^[A-Z0-9]{1,20}$/.test(clean)) return;
      updatePreference("chartSymbol", clean);
      setMintFor(mint ? { symbol: clean, mint } : null);
    },
    [updatePreference],
  );
  const mint = mintFor?.symbol === symbol ? mintFor.mint : undefined;
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
  const value = useMemo(
    () => ({ symbol, mint, selectAsset, newsFocus, focusAsset, clearNewsFocus, tradeVenue, setTradeVenue }),
    [symbol, mint, selectAsset, newsFocus, focusAsset, clearNewsFocus, tradeVenue],
  );
  return <SelectedAssetContext.Provider value={value}>{children}</SelectedAssetContext.Provider>;
}
