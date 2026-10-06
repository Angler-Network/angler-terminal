"use client";

import type { OrderResult } from "@/lib/venues/types";
import { filledUsd, type TradeEvent } from "./trades";

/** Fire-and-forget; analytics must never block or break a trade. */
export function trackTrade(event: TradeEvent) {
  try {
    const body = JSON.stringify(event);
    if (navigator.sendBeacon?.("/api/analytics/trade", body)) return;
    void fetch("/api/analytics/trade", { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {}
}

/** Reports a perp order with what actually filled and our fee rate on it. */
export function trackPerpOrder(result: OrderResult, event: Pick<TradeEvent, "venue" | "side" | "newsId" | "oneClick">) {
  trackTrade({ ...event, usd: filledUsd(result), feeBps: result.status === "filled" ? result.partnerFeeBps : null });
}
