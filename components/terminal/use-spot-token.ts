"use client";

import { useEffect, useState } from "react";
import { jupiterVenue } from "@/lib/venues/jupiter/venue";
import type { SpotToken } from "@/lib/venues/types";
import { isBookSpotRef } from "@/lib/spot/book-spot";
import { isEvmRef } from "@/lib/venues/uniswap/chains";

/** Waits between lookups that failed (Jupiter or our route down, rate limited): never read as "no such token". */
const RETRY_MS = [1_500, 4_000, 10_000, 20_000];

/**
 * Verified Jupiter token for a symbol (or mint). undefined while loading, null when there's none or when
 * `enabled` is false (callers skip the lookup when another venue already covers the asset). A lookup that fails stays
 * undefined and is tried again (backing off to every 20s), so a passing error never leaves the swap saying the token
 * doesn't exist.
 */
export function useSpotToken(symbol: string, mint?: string, wanted = true) {
  // An EVM token ref (a Uniswap token picked in the search) or a Hyperliquid/Lighter spot market has no Solana token.
  const enabled = wanted && !isEvmRef(mint) && !isBookSpotRef(mint);
  const [state, setState] = useState<{ key: string; token: SpotToken | null } | null>(null);
  const key = `${symbol}|${mint ?? ""}`;

  useEffect(() => {
    if (!enabled) return;
    let isActive = true;
    let timer: number | undefined;
    const attempt = (count: number) => {
      jupiterVenue
        .resolveToken({ symbol, mint })
        .then((token) => isActive && setState({ key, token }))
        .catch(() => {
          if (isActive) timer = window.setTimeout(() => attempt(count + 1), RETRY_MS[Math.min(count, RETRY_MS.length - 1)]);
        });
    };
    attempt(0);
    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [key, symbol, mint, enabled]);

  if (!enabled) return null;
  return state?.key === key ? state.token : undefined;
}
