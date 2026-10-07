"use client";

import { useEffect, useState } from "react";
import { usdToInputAmount } from "@/lib/venues/jupiter/amounts";
import { jupiterVenue } from "@/lib/venues/jupiter/venue";
import { getTitanQuote } from "@/lib/venues/titan/venue";
import type { OrderSide, SpotToken } from "@/lib/venues/types";

export type SpotSource = "jupiter" | "titan";

export interface SpotSourceQuote {
  source: SpotSource;
  /** Output in the output token's smallest unit, or null with `note` saying why there's no quote. */
  outAmount: bigint | null;
  outputToken: SpotToken | null;
  note: string | null;
}

const DEBOUNCE_MS = 400;
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
}: {
  token: SpotToken | null;
  side: OrderSide;
  sizeUsd: number;
  taker: string | null;
  titan: boolean;
}) {
  const [quotes, setQuotes] = useState<SpotSourceQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const key = [token?.mint, side, sizeUsd, taker, titan].join("|");

  useEffect(() => {
    if (!token || !(sizeUsd > 0)) {
      setQuotes([]);
      return;
    }
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const usdc = await jupiterVenue.quoteToken();
        const inputToken = side === "buy" ? usdc : token;
        const outputToken = side === "buy" ? token : usdc;
        const amount = usdToInputAmount(sizeUsd, side, usdc, token);
        const input = { inputToken, outputToken, amount, taker: taker ?? undefined };
        const [jupiter, titanQuote] = await Promise.all([
          // Price-only for Jupiter (no taker): the list compares routes; balances are checked when the swap is placed.
          jupiterVenue.getQuote({ ...input, taker: undefined }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error)))),
          titan && taker ? getTitanQuote(input).catch(() => null) : Promise.resolve(null),
        ]);
        if (!active) return;
        const rows: SpotSourceQuote[] = [
          jupiter instanceof Error || jupiter.error
            ? { source: "jupiter", outAmount: null, outputToken, note: (jupiter instanceof Error ? jupiter.message : jupiter.error) ?? "No quote" }
            : { source: "jupiter", outAmount: jupiter.outAmount, outputToken, note: null },
        ];
        if (titan) {
          rows.push(
            !taker
              ? { source: "titan", outAmount: null, outputToken, note: "Connect a Solana wallet" }
              : titanQuote
                ? { source: "titan", outAmount: titanQuote.outAmount, outputToken, note: null }
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
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void load();
    }, REFRESH_MS);
    return () => {
      active = false;
      window.clearTimeout(debounce);
      window.clearInterval(timer);
    };
    // key captures every input; token is compared by mint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { quotes, loading };
}
