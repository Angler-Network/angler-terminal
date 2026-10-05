"use client";

import { SOLSCAN_TX_URL } from "../jupiter/config";
import { walletErrorMessage } from "../jupiter/errors";
import { SwapFailedError } from "../jupiter/venue";
import { VenueError, type SpotQuote, type SpotQuoteInput, type SpotSwapResult, type TransactionSigner } from "../types";

/** Network fee for one signature; Titan routes carry no separate priority fee. */
const BASE_FEE_LAMPORTS = 5_000;

/** Set once the server says TITAN_API_KEY isn't configured, so the trader stops asking. */
let unconfigured = false;

function big(value: unknown) {
  return typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

/** Titan quote with a ready-to-sign transaction, or null when Titan is unavailable (no key, no route, down). */
export async function getTitanQuote({ inputToken, outputToken, amount, taker }: SpotQuoteInput): Promise<SpotQuote | null> {
  if (unconfigured || !taker || amount <= 0n) return null;
  const params = new URLSearchParams({ inputMint: inputToken.mint, outputMint: outputToken.mint, amount: amount.toString(), taker });
  try {
    const response = await fetch(`/api/titan/order?${params}`, { cache: "no-store" });
    if (response.status === 503) {
      unconfigured = true;
      return null;
    }
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.transaction !== "string") return null;
    return {
      requestId: typeof body.quoteId === "string" ? body.quoteId : "",
      inputToken,
      outputToken,
      inAmount: big(body.inAmount),
      outAmount: big(body.outAmount),
      minOutAmount: big(body.minOutAmount),
      slippageBps: Number(body.slippageBps) || 0,
      priceImpactPct: typeof body.priceImpactPct === "number" ? body.priceImpactPct : 0,
      feeBps: 0,
      networkFeeLamports: BASE_FEE_LAMPORTS,
      inUsdValue: typeof body.inUsdValue === "number" ? body.inUsdValue : undefined,
      outUsdValue: typeof body.outUsdValue === "number" ? body.outUsdValue : undefined,
      router: `Titan${typeof body.provider === "string" ? ` · ${body.provider}` : ""}`,
      transaction: body.transaction,
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

export async function executeTitanQuote(quote: SpotQuote, sign: TransactionSigner): Promise<SpotSwapResult> {
  if (!quote.transaction) throw new VenueError("This quote can't be executed.");
  let signedTransaction: string;
  try {
    signedTransaction = await sign(quote.transaction);
  } catch (error) {
    throw new VenueError(walletErrorMessage(error));
  }
  const response = await fetch("/api/titan/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signedTransaction }),
  });
  const body = (await response.json().catch(() => ({}))) as { status?: string; signature?: string; error?: string };
  const explorerUrl = body.signature ? `${SOLSCAN_TX_URL}${body.signature}` : undefined;
  if (body.status !== "Success" || !body.signature) throw new SwapFailedError(body.error ?? "The Titan swap failed.", explorerUrl);
  // Titan doesn't report fill amounts; the quote's amounts are what the user signed for (output at least minOut).
  return { signature: body.signature, inAmount: quote.inAmount, outAmount: quote.outAmount, explorerUrl: explorerUrl! };
}
