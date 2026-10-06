"use client";

import { useEffect, useState } from "react";
import { useTrading } from "@/components/terminal/trading-provider";
import { useWallet } from "@/components/terminal/wallet-provider";
import { hlHistory, type HlHistory } from "@/lib/venues/hyperliquid/history";
import { lighterHistory, type LighterHistory } from "@/lib/venues/lighter/history";

export const HISTORY_DAYS = 30;
const REFRESH_MS = 60_000;

export interface PortfolioHistory {
  loading: boolean;
  hyperliquid: HlHistory | null;
  lighter: LighterHistory | null;
  /** Venues whose history couldn't be read this time. */
  failed: Array<"hyperliquid" | "lighter">;
  /** Start of the fetched window (ms). */
  since: number;
}

/** 30 days of PnL, fills and funding for the connected wallet on each enabled perp venue, refreshed every minute. */
export function usePortfolioHistory(): PortfolioHistory {
  const { address } = useWallet();
  const { lighter, perpOrder } = useTrading();
  const hlOn = perpOrder.includes("hyperliquid");
  const lighterIndex = perpOrder.includes("lighter") ? (lighter?.accountIndex ?? null) : null;
  const [history, setHistory] = useState<PortfolioHistory>({ loading: true, hyperliquid: null, lighter: null, failed: [], since: 0 });

  useEffect(() => {
    // No EVM wallet: nothing to load (the page shows "connect" instead of a spinner).
    if (!address) return setHistory({ loading: false, hyperliquid: null, lighter: null, failed: [], since: 0 });
    let cancelled = false;
    const load = async () => {
      const since = Date.now() - HISTORY_DAYS * 86_400_000;
      const [hl, lt] = await Promise.allSettled([
        hlOn ? hlHistory(address, since) : Promise.resolve(null),
        lighterIndex !== null ? lighterHistory(lighterIndex, since) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setHistory((previous) => ({
        loading: false,
        // A failed refresh keeps the last good data on screen.
        hyperliquid: hl.status === "fulfilled" ? hl.value : previous.hyperliquid,
        lighter: lt.status === "fulfilled" ? lt.value : previous.lighter,
        failed: [...(hl.status === "rejected" ? (["hyperliquid"] as const) : []), ...(lt.status === "rejected" ? (["lighter"] as const) : [])],
        since,
      }));
    };
    setHistory({ loading: true, hyperliquid: null, lighter: null, failed: [], since: 0 });
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [address, hlOn, lighterIndex]);

  return history;
}
