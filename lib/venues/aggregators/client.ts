"use client";

import { VenueError } from "../types";
import type { UniswapQuote } from "../uniswap/quote";
import { AGGREGATOR_NAMES, type AggregatorProvider, type AggregatorQuoteBody } from "./types";

/** A quote from any EVM swap source, in the Uniswap quote's shape so the swap card shows them all alike. */
export type EvmSwapQuote = UniswapQuote & { provider: "uniswap" | AggregatorProvider; aggregator?: AggregatorQuoteBody };

export interface AggregatorQuoteInput {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amount: bigint;
  swapper?: string | null;
  slippageBps?: number | null;
  execute?: boolean;
}

export async function fetchAggregatorQuote(provider: AggregatorProvider, input: AggregatorQuoteInput): Promise<EvmSwapQuote> {
  let response: Response;
  try {
    response = await fetch("/api/aggregators/quote", {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider,
        chainId: input.chainId,
        sellToken: input.tokenIn,
        buyToken: input.tokenOut,
        sellAmount: input.amount.toString(),
        taker: input.swapper || null,
        slippageBps: input.slippageBps ?? null,
        execute: input.execute ?? false,
      }),
    });
  } catch {
    throw new VenueError(`${AGGREGATOR_NAMES[provider]} is unreachable right now.`);
  }
  const body = (await response.json().catch(() => ({}))) as AggregatorQuoteBody & { error?: string };
  if (!response.ok) throw new VenueError(body.error ?? `${AGGREGATOR_NAMES[provider]} has no route for this swap.`);
  return {
    provider,
    aggregator: body,
    routing: provider.toUpperCase(),
    settle: "tx",
    raw: {},
    permitData: null,
    inAmount: input.amount,
    outAmount: BigInt(body.outAmount),
    minOutAmount: body.minOutAmount ? BigInt(body.minOutAmount) : null,
    feeAmount: 0n,
    feeBps: body.feeBps,
    priceImpactPct: body.priceImpactPct ?? null,
    gasFeeUsd: body.gasFeeUsd ?? null,
    // The pools or DEXes it routes through ("via Uniswap V3, Aerodrome"); the card names the aggregator itself.
    route: body.route.filter((source) => source !== AGGREGATOR_NAMES[provider]),
    fetchedAt: Date.now(),
  };
}
