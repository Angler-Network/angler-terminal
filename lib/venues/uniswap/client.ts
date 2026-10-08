"use client";

import { VenueError } from "../types";
import { QUOTE_ONLY_SWAPPER } from "./config";
import { readUniswapQuote, uniswapErrorMessage } from "./quote";

/** Trading API calls through /api/uniswap, without viem, so the swap card can quote on first load. */

export async function callUniswap<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/uniswap/${path}`, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new VenueError("Uniswap is unreachable right now.");
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {}
  if (!response.ok) {
    const code = typeof parsed.errorCode === "string" ? parsed.errorCode : undefined;
    const detail = typeof parsed.detail === "string" ? parsed.detail : undefined;
    throw new VenueError(uniswapErrorMessage(code, detail, response.status), code);
  }
  return parsed as T;
}

export interface UniswapQuoteInput {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  /** Exact input in the input token's smallest unit. */
  amount: bigint;
  /** The signing wallet; price-only quotes use a placeholder. */
  swapper?: string | null;
  /** Fixed tolerance in bps; unset lets Uniswap pick (auto slippage). */
  slippageBps?: number | null;
  /** MEV-protected only: UniswapX orders (fillers settle them; nothing waits in the public mempool). */
  privateOnly?: boolean;
}

/** An exact-input quote with our fee included (the server adds it). */
export async function fetchUniswapQuote({ chainId, tokenIn, tokenOut, amount, swapper, slippageBps, privateOnly = false }: UniswapQuoteInput) {
  const body = await callUniswap<unknown>("quote", {
    type: "EXACT_INPUT",
    amount: amount.toString(),
    tokenInChainId: chainId,
    tokenOutChainId: chainId,
    tokenIn,
    tokenOut,
    swapper: swapper || QUOTE_ONLY_SWAPPER,
    ...(slippageBps ? { slippageTolerance: slippageBps / 100 } : { autoSlippage: "DEFAULT" }),
    routingPreference: "BEST_PRICE",
    ...(privateOnly ? { protocols: ["UNISWAPX_LATEST"] } : {}),
  });
  const quote = readUniswapQuote(body);
  if (!quote) throw new VenueError(privateOnly ? "No MEV-protected (UniswapX) route for this swap right now." : "Uniswap has no route this terminal can execute for this swap.");
  // A private swap never falls back to a transaction the wallet broadcasts publicly.
  if (privateOnly && quote.settle !== "order") throw new VenueError("No MEV-protected (UniswapX) route for this swap right now.");
  return quote;
}
