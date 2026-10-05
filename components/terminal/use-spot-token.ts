"use client";

import { useEffect, useState } from "react";
import { jupiterVenue } from "@/lib/venues/jupiter/venue";
import type { SpotToken } from "@/lib/venues/types";

/** Verified Jupiter token for a symbol (or mint). undefined while loading, null when there's none. */
export function useSpotToken(symbol: string, mint?: string) {
  const [state, setState] = useState<{ key: string; token: SpotToken | null } | null>(null);
  const key = `${symbol}|${mint ?? ""}`;

  useEffect(() => {
    let isActive = true;
    jupiterVenue
      .resolveToken({ symbol, mint })
      .then((token) => isActive && setState({ key, token }))
      .catch(() => isActive && setState({ key, token: null }));
    return () => {
      isActive = false;
    };
  }, [key, symbol, mint]);

  return state?.key === key ? state.token : undefined;
}
