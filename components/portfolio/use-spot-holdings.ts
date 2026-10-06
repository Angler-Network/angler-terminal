"use client";

import { useEffect, useState } from "react";
import { useSolanaWallet } from "@/components/terminal/solana-wallet-provider";
import type { SpotHoldings } from "@/lib/venues/jupiter/holdings";

const REFRESH_MS = 60_000;

export interface SpotHoldingsState {
  loading: boolean;
  data: SpotHoldings | null;
  failed: boolean;
}

/** The connected Solana wallet's tokens with USD values (`/api/solana/holdings`), refreshed every minute. */
export function useSpotHoldings(): SpotHoldingsState & { address: string | null } {
  const { address } = useSolanaWallet();
  const [state, setState] = useState<SpotHoldingsState>({ loading: false, data: null, failed: false });

  useEffect(() => {
    if (!address) return setState({ loading: false, data: null, failed: false });
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/solana/holdings?owner=${address}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as SpotHoldings;
        if (!cancelled) setState({ loading: false, data, failed: false });
      } catch {
        // A failed refresh keeps the last good list on screen.
        if (!cancelled) setState((previous) => ({ ...previous, loading: false, failed: true }));
      }
    };
    setState({ loading: true, data: null, failed: false });
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [address]);

  return { ...state, address };
}
