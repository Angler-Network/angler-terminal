"use client";

import { useEffect, useState } from "react";
import { HL_BASE_TAKER_FEE, compareExecution, readLighterRestBook, splitExecution, type SplitPlan, type VenueQuote } from "@/lib/trading/execution";
import { readHlBook, type BookSide } from "@/lib/trading/orderbook";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import { lighterConfig } from "@/lib/venues/lighter/config";
import { minimumSize } from "@/lib/venues/lighter/pricing";
import type { OrderSide, PerpVenueId, VenueMarket } from "@/lib/venues/types";

const DEBOUNCE_MS = 400;
/** Hyperliquid rejects orders under $10 of notional. */
const HL_MIN_ORDER_USD = 10;
const REFRESH_MS = 5_000;

/** Every fee a taker pays on the venue: base fee plus our builder (Hyperliquid) or integrator (Lighter) fee. */
export function takerFeeFor(market: VenueMarket) {
  if (market.venue === "hyperliquid") return HL_BASE_TAKER_FEE + (hlConfig.builder?.fee ?? 0) / 100_000;
  return (market.takerFee ?? 0) + (lighterConfig.integrator?.takerFee ?? 0) / 1_000_000;
}

async function fetchBook(market: VenueMarket): Promise<BookSide | null> {
  if (market.venue === "hyperliquid") {
    const response = await fetch(`${hlConfig.apiUrl}/info`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "l2Book", coin: market.coin }),
    });
    return response.ok ? readHlBook(await response.json()) : null;
  }
  const response = await fetch(`${lighterConfig.apiUrl}/api/v1/orderBookOrders?market_id=${market.assetId}&limit=100`);
  return response.ok ? readLighterRestBook(await response.json()) : null;
}

/** Smallest order a venue accepts, in USD (Lighter's from the market's minimums at the current price). */
export function minOrderUsd(market: VenueMarket) {
  if (market.venue === "hyperliquid") return HL_MIN_ORDER_USD;
  const price = market.midPx ?? market.markPx;
  return price ? minimumSize(market, price) * price : 0;
}

async function bookInputs(markets: VenueMarket[]) {
  const books = await Promise.all(markets.map((market) => fetchBook(market).catch(() => null)));
  return markets.flatMap((market, index) => {
    const book = books[index];
    return book ? [{ venue: market.venue, book, takerFee: takerFeeFor(market), minUsd: minOrderUsd(market) }] : [];
  });
}

/** Quotes a market order on each venue from fresh REST books, best first; venues whose book fails are left out. */
export async function quoteVenues(markets: VenueMarket[], side: OrderSide, sizeUsd: number) {
  return compareExecution(side, sizeUsd, await bookInputs(markets));
}

export interface BestExecution {
  quotes: Array<VenueQuote<PerpVenueId>>;
  /** Cheaper fill split across venues, when one exists and every leg meets its venue's minimum. */
  split: SplitPlan<PerpVenueId> | null;
}

const NONE: BestExecution = { quotes: [], split: null };

/**
 * Estimated cost of a market order of `sizeUsd` on each perp venue that lists the asset (order book walk + taker
 * fees), best first, plus the split across venues when that fills cheaper. Refreshes every few seconds while the
 * size is set; empty with fewer than two venues.
 */
export function useBestExecution(markets: VenueMarket[], side: OrderSide, sizeUsd: number, enabled: boolean): BestExecution {
  const [result, setResult] = useState<BestExecution>(NONE);
  const key = markets.map((market) => `${market.venue}:${market.coin}`).join(",");
  const active = enabled && markets.length > 1 && sizeUsd > 0;

  useEffect(() => {
    if (!active) {
      setResult(NONE);
      return;
    }
    let isActive = true;
    const run = async () => {
      const inputs = await bookInputs(markets);
      if (isActive) setResult({ quotes: compareExecution(side, sizeUsd, inputs), split: splitExecution(side, sizeUsd, inputs) });
    };
    const debounce = window.setTimeout(() => void run(), DEBOUNCE_MS);
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void run(), REFRESH_MS);
    return () => {
      isActive = false;
      window.clearTimeout(debounce);
      window.clearInterval(timer);
    };
  }, [active, key, side, sizeUsd]); // eslint-disable-line react-hooks/exhaustive-deps

  return result;
}
