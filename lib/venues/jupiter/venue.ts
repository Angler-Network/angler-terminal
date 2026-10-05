"use client";

import type { SpotBalances, SpotQuote, SpotQuoteInput, SpotToken, SpotVenue, TransactionSigner } from "../types";
import { VenueError } from "../types";
import { SOLSCAN_TX_URL, USDC_MINT } from "./config";
import { executeErrorMessage, walletErrorMessage } from "./errors";
import { toSpotQuote, type JupOrderResponse } from "./quote";

const TOKEN_TTL_MS = 5 * 60_000;

const tokenCache = new Map<string, { at: number; promise: Promise<SpotToken | null> }>();

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  try {
    return (await response.json()) as T & { error?: string };
  } catch {
    return { error: `Request failed (${response.status})` } as T & { error?: string };
  }
}

function resolveToken(query: { symbol: string; mint?: string }) {
  const key = query.mint ? `mint:${query.mint}` : `symbol:${query.symbol.toUpperCase()}`;
  const cached = tokenCache.get(key);
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.promise;
  const params = new URLSearchParams(query.mint ? { mint: query.mint } : { symbol: query.symbol });
  const promise = fetch(`/api/jup/token?${params}`).then(async (response) => {
    if (response.status === 404) return null;
    const body = await readJson<{ token: SpotToken | null }>(response);
    if (!response.ok) throw new VenueError(body.error ?? "Jupiter token search failed.");
    return body.token;
  });
  tokenCache.set(key, { at: Date.now(), promise });
  promise.catch(() => tokenCache.delete(key));
  return promise;
}

async function quoteToken() {
  const usdc = await resolveToken({ symbol: "USDC", mint: USDC_MINT });
  if (!usdc) throw new VenueError("USDC isn't available on Jupiter right now.");
  return usdc;
}

async function getQuote({ inputToken, outputToken, amount, taker }: SpotQuoteInput): Promise<SpotQuote> {
  if (amount <= 0n) throw new VenueError("Enter a size.");
  const params = new URLSearchParams({ inputMint: inputToken.mint, outputMint: outputToken.mint, amount: amount.toString() });
  if (taker) params.set("taker", taker);
  const response = await fetch(`/api/jup/order?${params}`, { cache: "no-store" });
  const body = await readJson<JupOrderResponse>(response);
  if (!response.ok) throw new VenueError(body.errorMessage ?? body.error ?? `Jupiter quote failed (${response.status}).`);
  return toSpotQuote(body, inputToken, outputToken);
}

interface ExecuteResponse {
  status?: "Success" | "Failed";
  signature?: string;
  code?: number;
  error?: string;
  totalInputAmount?: string;
  totalOutputAmount?: string;
}

/** Thrown when the swap failed on-chain but a signature exists, so the UI can still link to Solscan. */
export class SwapFailedError extends VenueError {
  constructor(
    message: string,
    readonly explorerUrl?: string,
  ) {
    super(message);
  }
}

async function executeQuote(quote: SpotQuote, sign: TransactionSigner) {
  if (!quote.transaction) throw new VenueError(quote.error ?? "This quote can't be executed.");
  let signedTransaction: string;
  try {
    signedTransaction = await sign(quote.transaction);
  } catch (error) {
    throw new VenueError(walletErrorMessage(error));
  }
  const response = await fetch("/api/jup/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signedTransaction, requestId: quote.requestId }),
  });
  const body = await readJson<ExecuteResponse>(response);
  const explorerUrl = body.signature ? `${SOLSCAN_TX_URL}${body.signature}` : undefined;
  if (!response.ok || body.status !== "Success" || !body.signature) {
    throw new SwapFailedError(executeErrorMessage(body.code, body.error), explorerUrl);
  }
  return {
    signature: body.signature,
    inAmount: /^\d+$/.test(body.totalInputAmount ?? "") ? BigInt(body.totalInputAmount!) : quote.inAmount,
    outAmount: /^\d+$/.test(body.totalOutputAmount ?? "") ? BigInt(body.totalOutputAmount!) : quote.outAmount,
    explorerUrl: explorerUrl!,
  };
}

async function getBalances(owner: string, mints: string[]): Promise<SpotBalances> {
  const params = new URLSearchParams({ owner, mints: mints.join(",") });
  const response = await fetch(`/api/solana/balances?${params}`, { cache: "no-store" });
  const body = await readJson<{ lamports: string; tokens: Record<string, string> }>(response);
  if (!response.ok) throw new VenueError(body.error ?? "Couldn't load balances.");
  return {
    lamports: BigInt(body.lamports),
    tokens: Object.fromEntries(Object.entries(body.tokens).map(([mint, amount]) => [mint, BigInt(amount)])),
  };
}

export const jupiterVenue: SpotVenue = {
  kind: "spot",
  id: "jupiter",
  name: "Jupiter",
  quoteToken,
  resolveToken,
  getQuote,
  executeQuote,
  getBalances,
};
