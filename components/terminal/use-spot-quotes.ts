"use client";

import { useEffect, useState } from "react";
import { onUserBack, userIdle } from "@/lib/activity";
import { usdToInputAmount } from "@/lib/venues/jupiter/amounts";
import { jupiterVenue } from "@/lib/venues/jupiter/venue";
import { getTitanQuote } from "@/lib/venues/titan/venue";
import type { ArcusToken } from "@/lib/venues/arcus/tokens";
import { quoteRobinhood } from "@/lib/venues/robinhood-quotes";
import type { RobinhoodSource } from "@/lib/venues/robinhood-sources";
import type { OrderSide, SpotQuote, SpotToken } from "@/lib/venues/types";

/** Solana aggregators (Jupiter, Titan) or Robinhood Chain stock swap sources (Arcus, Uniswap). */
export type SpotSource = "jupiter" | "titan" | RobinhoodSource;

export interface SpotSourceQuote {
  source: SpotSource;
  /** Output in the output token's smallest unit, or null with `note` saying why there's no quote. */
  outAmount: bigint | null;
  outputToken: Pick<SpotToken, "symbol" | "decimals"> | null;
  note: string | null;
  /** The DEXes the route trades through (Raydium, Pump.fun, Meteora…), in order. */
  route?: string[];
  /** The quote's details for the swap card's summary. */
  minOut?: bigint;
  priceImpactPct?: number;
  feeBps?: number;
  slippageBps?: number;
  /** Gas the wallet pays in USD (Uniswap pool swaps); 0 when a relayer or filler pays it. */
  gasFeeUsd?: number | null;
}

const DEBOUNCE_MS = 400;

const details = (quote: SpotQuote) => ({
  route: quote.route,
  minOut: quote.minOutAmount,
  priceImpactPct: quote.priceImpactPct,
  feeBps: quote.feeBps,
  slippageBps: quote.slippageBps,
});
const REFRESH_MS = 10_000;

/**
 * Live Jupiter and Titan quotes for a USDC ↔ token swap of `sizeUsd`, best first, refreshed every few seconds. Titan
 * builds its route for a wallet, so it only quotes once a Solana wallet is connected.
 */
export function useSpotQuotes({
  token,
  side,
  sizeUsd,
  taker,
  titan,
  slippageBps = null,
  quoteMint,
}: {
  token: SpotToken | null;
  side: OrderSide;
  sizeUsd: number;
  taker: string | null;
  titan: boolean;
  slippageBps?: number | null;
  /** The other side of the swap; USDC when unset. */
  quoteMint?: string;
}) {
  const [quotes, setQuotes] = useState<SpotSourceQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const key = [token?.mint, side, sizeUsd, taker, titan, slippageBps, quoteMint].join("|");

  useEffect(() => {
    if (!token || !(sizeUsd > 0)) {
      setQuotes([]);
      return;
    }
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const payToken = await jupiterVenue.quoteToken(quoteMint);
        const inputToken = side === "buy" ? payToken : token;
        const outputToken = side === "buy" ? token : payToken;
        const amount = usdToInputAmount(sizeUsd, side, payToken, token);
        const input = { inputToken, outputToken, amount, taker: taker ?? undefined, slippageBps };
        const [jupiter, titanQuote] = await Promise.all([
          // Price-only for Jupiter (no taker): the list compares routes; balances are checked when the swap is placed.
          jupiterVenue.getQuote({ ...input, taker: undefined }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error)))),
          titan && taker ? getTitanQuote(input).catch(() => null) : Promise.resolve(null),
        ]);
        if (!active) return;
        const rows: SpotSourceQuote[] = [
          jupiter instanceof Error || jupiter.error
            ? { source: "jupiter", outAmount: null, outputToken, note: (jupiter instanceof Error ? jupiter.message : jupiter.error) ?? "No quote" }
            : { source: "jupiter", outAmount: jupiter.outAmount, outputToken, note: null, ...details(jupiter) },
        ];
        if (titan) {
          rows.push(
            !taker
              ? { source: "titan", outAmount: null, outputToken, note: "Connect a Solana wallet" }
              : titanQuote
                ? { source: "titan", outAmount: titanQuote.outAmount, outputToken, note: null, ...details(titanQuote) }
                : { source: "titan", outAmount: null, outputToken, note: "No route" },
          );
        }
        // Best first; rows without a quote go last.
        rows.sort((a, b) => (a.outAmount === null ? 1 : b.outAmount === null ? -1 : a.outAmount === b.outAmount ? 0 : a.outAmount > b.outAmount ? -1 : 1));
        setQuotes(rows);
      } catch {
        if (active) setQuotes([]);
      } finally {
        if (active) setLoading(false);
      }
    };
    const debounce = window.setTimeout(load, DEBOUNCE_MS);
    // Paused while the user is away (`lib/activity.ts`), refreshed the moment they're back.
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden" && !userIdle()) void load();
    }, REFRESH_MS);
    const stopWake = onUserBack(() => void load());
    return () => {
      active = false;
      stopWake();
      window.clearTimeout(debounce);
      window.clearInterval(timer);
    };
    // key captures every input; token is compared by mint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { quotes, loading };
}

/**
 * Arcus and Uniswap quotes for a USDG ↔ stock token swap on Robinhood Chain, best first, refreshed like the Solana
 * ones. Uniswap quotes for the connected wallet when there is one.
 */
export function useRobinhoodQuotes({
  token,
  side,
  sizeUsd,
  taker,
  sources,
  slippageBps = null,
  preferArcus = false,
}: {
  token: ArcusToken | null;
  side: OrderSide;
  sizeUsd: number;
  taker: string | null;
  sources: RobinhoodSource[];
  slippageBps?: number | null;
  preferArcus?: boolean;
}) {
  const [quotes, setQuotes] = useState<SpotSourceQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const key = [token?.address, side, sizeUsd, taker, sources.join(","), slippageBps, preferArcus].join("|");

  useEffect(() => {
    if (!token || !(sizeUsd > 0) || sources.length === 0) {
      setQuotes([]);
      return;
    }
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const set = await quoteRobinhood({ token, side, sizeUsd, sources, taker, slippageBps, preferArcus });
        if (!active) return;
        setQuotes(
          set.quotes.map((quote) => ({
            source: quote.source,
            outAmount: quote.out,
            outputToken: set.buyToken,
            note: quote.note,
            route: quote.uniswap?.route,
            minOut: quote.uniswap?.minOutAmount ?? undefined,
            priceImpactPct: quote.uniswap?.priceImpactPct ?? undefined,
            feeBps: quote.uniswap?.feeBps,
            gasFeeUsd: quote.source === "arcus" ? 0 : quote.uniswap?.gasFeeUsd,
          })),
        );
      } catch {
        if (active) setQuotes([]);
      } finally {
        if (active) setLoading(false);
      }
    };
    const debounce = window.setTimeout(load, DEBOUNCE_MS);
    // Paused while the user is away (`lib/activity.ts`), refreshed the moment they're back.
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden" && !userIdle()) void load();
    }, REFRESH_MS);
    const stopWake = onUserBack(() => void load());
    return () => {
      active = false;
      stopWake();
      window.clearTimeout(debounce);
      window.clearInterval(timer);
    };
    // key captures every input; the token is compared by address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { quotes, loading };
}
