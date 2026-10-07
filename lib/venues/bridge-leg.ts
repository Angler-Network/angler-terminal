"use client";

import type { EIP1193Provider } from "viem";
import { summarizeAcrossQuote, type AcrossQuoteRequest, type AcrossQuoteSummary } from "./across";
import type { AcrossQuote } from "./across-client";
import { publicClientOn, readUsdcBalance, walletOn } from "./deposit-client";
import type { SourceChain } from "./deposits";
import { readRelayQuote, relayErrorMessage, relayFillState, relayQuoteBody, relaySwapBody, type RelayQuote, type RelaySwapRequest } from "./relay";
import { VenueError } from "./types";

/**
 * One bridge leg (a `FundsStep` of kind "across": the funds window, the swap cards) quoted on Across and Relay at
 * once; the larger output runs, Across on a tie. Both clients load on demand.
 */

export type BridgeProvider = "across" | "relay";

export const BRIDGE_PROVIDER_NAMES: Record<BridgeProvider, string> = { across: "Across", relay: "Relay" };

export type BridgeLegQuote = AcrossQuoteSummary & { provider: BridgeProvider } & (
    | { provider: "across"; raw: AcrossQuote }
    | { provider: "relay"; raw: RelayQuote }
  );

export interface BridgeLegQuotes {
  /** The executable quote with the larger output, or null with every provider's reason in `quotes`. */
  best: BridgeLegQuote | null;
  quotes: Array<{ provider: BridgeProvider; quote?: BridgeLegQuote; error?: string }>;
}

/** How a sent leg is followed until it fills. */
export type BridgeLegRef = { provider: "across"; depositId: bigint } | { provider: "relay"; requestId: string };

const message = (caught: unknown) => (caught instanceof Error ? caught.message : String(caught));

async function quoteAcross(request: AcrossQuoteRequest): Promise<BridgeLegQuote> {
  const { fetchAcrossQuote } = await import("./across-client");
  const raw = await fetchAcrossQuote(request);
  return { ...summarizeAcrossQuote(raw), provider: "across", raw };
}

/** A Relay quote for any token pair (a bridge leg's dollars, or the swap card's cross-chain swaps). */
export async function fetchRelayQuote(request: RelaySwapRequest): Promise<RelayQuote> {
  let response: Response;
  try {
    response = await fetch("/api/relay/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(relaySwapBody(request)) });
  } catch {
    throw new VenueError("Relay is unreachable right now.");
  }
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) throw new VenueError(relayErrorMessage(body, response.status));
  const raw = readRelayQuote(body, request.originChainId);
  if (!raw) throw new VenueError("Relay sent a quote this terminal can't read.");
  return raw;
}

async function quoteRelay(request: AcrossQuoteRequest): Promise<BridgeLegQuote> {
  const body = relayQuoteBody(request);
  const raw = await fetchRelayQuote({ ...body, amount: request.units });
  const { requestId: _requestId, txs: _txs, ...summary } = raw;
  return { ...summary, provider: "relay", raw };
}

/** Sends a Relay quote's transactions on its origin chain, each confirmed before the next; resolves to the last hash. */
export async function sendRelayTxs(provider: EIP1193Provider, account: `0x${string}`, from: SourceChain, quote: RelayQuote) {
  const [{ wallet, chain }, client] = await Promise.all([walletOn(provider, account, from), publicClientOn(from)]);
  let hash: `0x${string}` | undefined;
  for (const tx of quote.txs) {
    hash = await wallet.sendTransaction({ account, chain, to: tx.to, data: tx.data, value: tx.value, gas: tx.gas });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new VenueError("The Relay transaction reverted. Nothing was sent.");
  }
  if (!hash) throw new VenueError("Relay's quote had nothing to send.");
  return { hash, explorerUrl: `${from.explorer}/tx/${hash}` };
}

export async function quoteBridgeLeg(request: AcrossQuoteRequest): Promise<BridgeLegQuotes> {
  const results = await Promise.allSettled([quoteAcross(request), quoteRelay(request)]);
  const quotes = (["across", "relay"] as const).map((provider, index) => {
    const result = results[index];
    return result.status === "fulfilled" ? { provider, quote: result.value } : { provider, error: message(result.reason) };
  });
  let best: BridgeLegQuote | null = null;
  for (const entry of quotes) {
    const quote = entry.quote;
    if (quote?.executable && (!best || quote.expectedOut > best.expectedOut)) best = quote;
  }
  return { best, quotes };
}

/** The reason a leg has no route: the first provider's error, else a plain line. */
export function noRouteReason(result: BridgeLegQuotes) {
  return result.quotes.find((entry) => entry.error)?.error ?? "No bridge has a route for this amount right now.";
}

/**
 * Sends the chosen quote from the origin chain: Across through its SDK (approval + deposit), Relay as the
 * transactions its quote lists, each confirmed before the next. Resolves once the deposit is in.
 */
export async function executeBridgeLeg(provider: EIP1193Provider, account: `0x${string}`, from: SourceChain, to: SourceChain, units: bigint, quote: BridgeLegQuote) {
  if (quote.provider === "across") {
    const { executeAcross } = await import("./across-client");
    const sent = await executeAcross(provider, account, from, to, quote.raw);
    return { ref: { provider: "across", depositId: sent.depositId } as BridgeLegRef, explorerUrl: sent.explorerUrl };
  }
  // Relay doesn't check balances in its quote: refuse here rather than send a deposit that reverts.
  if ((await readUsdcBalance(from, account)) < units) throw new VenueError(`Not enough ${from.symbol} in your wallet on ${from.name}.`);
  const sent = await sendRelayTxs(provider, account, from, quote.raw);
  return { ref: { provider: "relay", requestId: quote.raw.requestId } as BridgeLegRef, explorerUrl: sent.explorerUrl };
}

/** One look at a sent leg: pending, filled on the destination, or failed (refunded on the origin chain). */
export async function bridgeLegState(ref: BridgeLegRef, originChainId: number) {
  if (ref.provider === "across") {
    const { acrossFilled } = await import("./across-client");
    return acrossFilled(ref.depositId, originChainId);
  }
  return relayRequestState(ref.requestId);
}

export async function relayRequestState(requestId: string) {
  const response = await fetch(`/api/relay/intents/status/v2?requestId=${requestId}`, { cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as { status?: unknown };
  if (!response.ok) throw new VenueError(relayErrorMessage(body, response.status));
  return relayFillState(body.status);
}
