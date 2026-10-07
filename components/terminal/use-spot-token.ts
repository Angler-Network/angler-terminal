"use client";

import { useEffect, useState } from "react";
import { jupiterVenue } from "@/lib/venues/jupiter/venue";
import type { SpotToken } from "@/lib/venues/types";
import { isEvmRef } from "@/lib/venues/uniswap/chains";

/**
 * Verified Jupiter token for a symbol (or mint). undefined while loading, null when there's none or when
 * `enabled` is false (callers skip the lookup when another venue already covers the asset).
 */
export function useSpotToken(symbol: string, mint?: string, wanted = true) {
  // An EVM token ref (a Uniswap token picked in the search) has no Solana token.
  const enabled = wanted && !isEvmRef(mint);
  const [state, setState] = useState<{ key: string; token: SpotToken | null } | null>(null);
  const key = `${symbol}|${mint ?? ""}`;

  useEffect(() => {
    if (!enabled) return;
    let isActive = true;
    jupiterVenue
      .resolveToken({ symbol, mint })
      .then((token) => isActive && setState({ key, token }))
      .catch(() => isActive && setState({ key, token: null }));
    return () => {
      isActive = false;
    };
  }, [key, symbol, mint, enabled]);

  if (!enabled) return null;
  return state?.key === key ? state.token : undefined;
}
