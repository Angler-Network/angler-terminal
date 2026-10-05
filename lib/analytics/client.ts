"use client";

import type { TradeEvent } from "./trades";

/** Fire-and-forget; analytics must never block or break a trade. */
export function trackTrade(event: TradeEvent) {
  try {
    const body = JSON.stringify(event);
    if (navigator.sendBeacon?.("/api/analytics/trade", body)) return;
    void fetch("/api/analytics/trade", { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {}
}
