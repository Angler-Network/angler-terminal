"use client";

import { useEffect, useState } from "react";
import type { Market, MarketType } from "@/lib/markets/model";

/** Every listed market of a type (Binance + Hyperliquid perps/spot + HIP-3 stock perps), from /api/markets. */
export function useMarketList(type: MarketType) {
  const [state, setState] = useState<{ type: MarketType; markets: Market[] } | null>(null);

  useEffect(() => {
    let isActive = true;
    fetch(`/api/markets?market=${type}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((markets: Market[]) => {
        if (isActive) setState({ type, markets });
      })
      .catch(() => {});
    return () => {
      isActive = false;
    };
  }, [type]);

  return state?.type === type ? state.markets : null;
}
