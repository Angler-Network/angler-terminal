"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { usePreferences } from "@/components/app/preferences-provider";

interface SelectedAssetValue {
  symbol: string;
  selectAsset: (symbol: string) => void;
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
  const selectAsset = useCallback(
    (next: string) => {
      const clean = next.toUpperCase();
      if (/^[A-Z0-9]{1,20}$/.test(clean)) updatePreference("chartSymbol", clean);
    },
    [updatePreference],
  );
  const value = useMemo(() => ({ symbol, selectAsset }), [symbol, selectAsset]);
  return <SelectedAssetContext.Provider value={value}>{children}</SelectedAssetContext.Provider>;
}
