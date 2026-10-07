"use client";

import { arcusIndicativeOut, arcusQuoteToken } from "./arcus/catalog";
import { arcusConfig } from "./arcus/config";
import type { ArcusToken } from "./arcus/tokens";
import { orderRobinhoodQuotes, type RobinhoodSource } from "./robinhood-sources";
import type { OrderSide } from "./types";
import { fetchUniswapQuote } from "./uniswap/client";
import type { UniswapQuote } from "./uniswap/quote";

/** One source's answer for a Robinhood Chain stock swap; `out` null with `note` saying why there's none. */
export interface RobinhoodQuote {
  source: RobinhoodSource;
  out: bigint | null;
  note: string | null;
  uniswap?: UniswapQuote;
}

export interface RobinhoodQuoteSet {
  sellToken: ArcusToken;
  buyToken: ArcusToken;
  sellAmount: bigint;
  /** Best first; sources without a quote last. */
  quotes: RobinhoodQuote[];
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Quotes a USD-sized swap between USDG and a stock token on every enabled source. A sale is sized from what the USD
 * amount buys right now (Arcus's price, else Uniswap's), like the Arcus flow always did.
 */
export async function quoteRobinhood({
  token,
  side,
  sizeUsd,
  sources,
  taker,
  slippageBps,
  preferArcus = false,
}: {
  token: ArcusToken;
  side: OrderSide;
  sizeUsd: number;
  sources: RobinhoodSource[];
  taker?: string | null;
  slippageBps?: number | null;
  /** Arcus leads unless Uniswap pays over `PREFER_ARCUS_BPS` more (`orderRobinhoodQuotes`). */
  preferArcus?: boolean;
}): Promise<RobinhoodQuoteSet> {
  const stable = await arcusQuoteToken();
  const usdAmount = BigInt(Math.floor(sizeUsd * 10 ** stable.decimals));
  const uniswapQuote = (sellToken: ArcusToken, buyToken: ArcusToken, amount: bigint) =>
    fetchUniswapQuote({ chainId: arcusConfig.chainId, tokenIn: sellToken.address, tokenOut: buyToken.address, amount, swapper: taker, slippageBps });

  let sellAmount = usdAmount;
  if (side === "sell") {
    const arcusPrice = sources.includes("arcus") ? await arcusIndicativeOut(stable, token, usdAmount).catch(() => null) : null;
    const tokens = arcusPrice ?? (sources.includes("uniswap") ? (await uniswapQuote(stable, token, usdAmount).catch(() => null))?.outAmount : null);
    if (!tokens) {
      return { sellToken: token, buyToken: stable, sellAmount: 0n, quotes: sources.map((source) => ({ source, out: null, note: "No price right now" })) };
    }
    sellAmount = tokens;
  }
  const sellToken = side === "buy" ? stable : token;
  const buyToken = side === "buy" ? token : stable;
  const quotes = await Promise.all(
    sources.map(async (source): Promise<RobinhoodQuote> => {
      try {
        if (source === "arcus") {
          const out = await arcusIndicativeOut(sellToken, buyToken, sellAmount);
          return out ? { source, out, note: null } : { source, out: null, note: "No quote" };
        }
        const quote = await uniswapQuote(sellToken, buyToken, sellAmount);
        return { source, out: quote.outAmount, note: null, uniswap: quote };
      } catch (error) {
        return { source, out: null, note: message(error) };
      }
    }),
  );
  return { sellToken, buyToken, sellAmount, quotes: orderRobinhoodQuotes(quotes, preferArcus) };
}
