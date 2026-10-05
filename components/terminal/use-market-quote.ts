"use client";

import { useEffect, useState } from "react";
import { pickQuote, type Market, type Quote } from "@/lib/markets/model";

const TTL_MS = 30_000;

let cache: { at: number; promise: Promise<Map<string, Market>> } | null = null;

/** One shared /api/markets request for every card, refreshed at most every 30s. */
function loadQuotes() {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const promise = fetch("/api/markets?market=perp")
      .then((response) => (response.ok ? (response.json() as Promise<Market[]>) : []))
      .then((markets) => new Map(markets.map((market) => [market.symbol, market])))
      .catch(() => new Map<string, Market>());
    cache = { at: Date.now(), promise };
  }
  return cache.promise;
}

/** 24h price and change for a symbol (Binance, then Hyperliquid), or null when unknown. */
export function useMarketQuote(symbol: string) {
  const [quote, setQuote] = useState<Quote | null>(null);
  useEffect(() => {
    let isActive = true;
    const read = () =>
      void loadQuotes().then((markets) => {
        const market = markets.get(symbol.toUpperCase());
        if (isActive) setQuote(market ? (pickQuote(market, "binance")?.quote ?? null) : null);
      });
    read();
    const timer = window.setInterval(read, TTL_MS);
    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [symbol]);
  return quote;
}
