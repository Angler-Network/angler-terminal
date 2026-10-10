"use client";

import { useEffect, useState } from "react";
import { HL_BASE_TAKER_FEE, compareExecution, readLighterRestBook, splitExecution, type SplitPlan, type VenueQuote } from "@/lib/trading/execution";
import { readAsterBook, readExtendedBook, readHlBook, type BookSide } from "@/lib/trading/orderbook";
import { extendedConfig } from "@/lib/venues/extended/config";
import { asterConfig } from "@/lib/venues/aster/config";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import { lighterConfigs } from "@/lib/venues/lighter/config";
import { orderlyConfig } from "@/lib/venues/orderly/config";
import { minimumSize } from "@/lib/venues/lighter/pricing";
import type { OrderSide, PerpVenueId, VenueMarket } from "@/lib/venues/types";

const DEBOUNCE_MS = 400;
/** Hyperliquid rejects orders under $10 of notional. */
const HL_MIN_ORDER_USD = 10;
const REFRESH_MS = 5_000;
/** Extended's taker fee (2.5 bps; its 24/5 stock markets 1 bp). */
const EXTENDED_BASE_TAKER_FEE = 0.00025;
/** Aster's base-tier taker fee (accounts with volume pay less), plus our builder fee on top. */
const ASTER_BASE_TAKER_FEE = 0.00035;

/** Every fee a taker pays on the venue: base fee plus our builder (Hyperliquid) or integrator (Lighter) fee. */
export function takerFeeFor(market: VenueMarket) {
  if (market.venue === "hyperliquid") return HL_BASE_TAKER_FEE + (hlConfig.builder?.fee ?? 0) / 100_000;
  if (market.venue === "aster") return ASTER_BASE_TAKER_FEE + (asterConfig.builder?.feeRate ?? 0);
  // Orderly: the broker's rate (Orderly's base plus our part), as set in its admin.
  if (market.venue === "orderly") return orderlyConfig.takerFee;
  // Extended: its base taker fee plus our builder fee (mainnet).
  if (market.venue === "extended") return EXTENDED_BASE_TAKER_FEE + (extendedConfig.builderId ? extendedConfig.builderFee : 0);
  return (market.takerFee ?? 0) + (lighterConfigs[market.venue].integrator?.takerFee ?? 0) / 1_000_000;
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
  if (market.venue === "aster") {
    const response = await fetch(`${asterConfig.apiUrl}/fapi/v1/depth?symbol=${market.coin}&limit=100`);
    return response.ok ? readAsterBook(await response.json()) : null;
  }
  if (market.venue === "orderly") {
    // Orderly's REST book needs a signed account: its public WebSocket snapshot instead (loaded on demand).
    const { orderlyBookSnapshot } = await import("@/lib/venues/orderly/stream");
    return orderlyBookSnapshot(market.coin);
  }
  if (market.venue === "extended") {
    // Extended's REST API has no CORS: through our proxy (cached 2s at the edge).
    const response = await fetch(`${extendedConfig.proxy}/${extendedConfig.network}/api/v1/info/markets/${encodeURIComponent(market.coin)}/orderbook`);
    return response.ok ? readExtendedBook(((await response.json()) as { data?: unknown }).data) : null;
  }
  // Each Lighter exchange (core, Robinhood) has its own books.
  const response = await fetch(`${lighterConfigs[market.venue].apiUrl}/api/v1/orderBookOrders?market_id=${market.assetId}&limit=100`);
  return response.ok ? readLighterRestBook(await response.json()) : null;
}

/** Smallest order a venue accepts, in USD (Lighter's from the market's minimums at the current price). */
export function minOrderUsd(market: VenueMarket) {
  if (market.venue === "hyperliquid") return HL_MIN_ORDER_USD;
  if (market.venue === "aster") return market.minQuoteAmount ?? 5;
  if (market.venue === "orderly") return market.minQuoteAmount ?? 10;
  if (market.venue === "extended") return (market.minBaseAmount ?? 0) * (market.midPx ?? market.markPx ?? 0);
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
