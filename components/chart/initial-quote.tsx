"use client";

import { createContext, use, useContext } from "react";
import type { Quote } from "@/lib/markets/model";

export type InitialQuote = { symbol: string } & Quote;

const InitialQuoteContext = createContext<Promise<InitialQuote | null> | null>(null);

/**
 * Carries the chart price the server streams in (`app/page.tsx`), so the header shows it in the first HTML instead of
 * after hydration and the browser's own market list request.
 */
export function InitialQuoteProvider({ quote, children }: { quote: Promise<InitialQuote | null>; children: React.ReactNode }) {
  return <InitialQuoteContext.Provider value={quote}>{children}</InitialQuoteContext.Provider>;
}

export function useInitialQuote() {
  return useContext(InitialQuoteContext);
}

/**
 * The live quote when the browser has one, else the streamed one for this asset. Both render through the same
 * element, so the live price updates the server's in place: a new element would count as a later (and so slower)
 * Largest Contentful Paint. Wrap it in Suspense.
 */
export function QuoteSlot({
  live,
  initial,
  symbol,
  children,
}: {
  live: Quote | undefined;
  initial: Promise<InitialQuote | null> | null;
  symbol: string;
  children: (quote: Quote) => React.ReactNode;
}) {
  const streamed = initial ? use(initial) : null;
  const quote = live ?? (streamed?.symbol === symbol ? streamed : undefined);
  return quote ? children(quote) : null;
}
