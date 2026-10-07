"use client";

import type { EIP1193Provider } from "viem";
import { acrossErrorMessage, acrossFillState, acrossQuoteParams, type AcrossQuoteRequest } from "./across";
import type { SourceChain } from "./deposits";
import { publicClientOn, walletOn } from "./deposit-client";
import { VenueError } from "./types";

/** Across in the browser: quotes and fills through `/api/across`, signing with the official SDK (loaded on demand). */

const API = "/api/across";

export type AcrossQuote = Awaited<ReturnType<typeof import("@across-protocol/app-sdk").getSwapQuote>>;

export async function fetchAcrossQuote(request: AcrossQuoteRequest): Promise<AcrossQuote> {
  const { getSwapQuote } = await import("@across-protocol/app-sdk");
  try {
    return await getSwapQuote({ ...acrossQuoteParams(request), apiUrl: API });
  } catch (caught) {
    // The SDK throws its own error types; keep the message the API gave.
    const error = caught as { message?: string; status?: number };
    throw new VenueError(acrossErrorMessage({ message: error.message }, error.status ?? 0));
  }
}

/**
 * Signs the quote's approval (when the allowance is short) and deposit on the origin chain and waits for the deposit
 * to confirm. The relayer's fill on the destination comes after (`acrossFilled`).
 */
export async function executeAcross(provider: EIP1193Provider, account: `0x${string}`, from: SourceChain, to: SourceChain, quote: AcrossQuote) {
  const [{ executeSwapQuote }, { wallet }, originClient, destinationClient] = await Promise.all([
    import("@across-protocol/app-sdk"),
    walletOn(provider, account, from),
    publicClientOn(from),
    publicClientOn(to),
  ]);
  const result = await executeSwapQuote({
    // Unused by execution: attribution travels in the quoted calldata (the server adds it to the quote request).
    integratorId: "0x0000",
    swapQuote: quote,
    // Chain-specific viem clients (Arbitrum's formatters) are wider than the SDK's generic client types.
    walletClient: wallet as never,
    originClient: originClient as never,
    destinationClient: destinationClient as never,
    throwOnError: true,
  });
  if (result.depositId === undefined || !result.swapTxReceipt) throw new VenueError("The bridge deposit didn't confirm.");
  const hash = result.swapTxReceipt.transactionHash;
  return { depositId: result.depositId, hash, explorerUrl: `${from.explorer}/tx/${hash}` };
}

/** One look at the deposit: pending, filled on the destination, or failed (expired / refunded on the origin chain). */
export async function acrossFilled(depositId: bigint, originChainId: number) {
  const response = await fetch(`${API}/deposit/status?depositId=${depositId}&originChainId=${originChainId}`, { cache: "no-store" });
  if (response.status === 404) return "pending" as const;
  const body = (await response.json().catch(() => ({}))) as { status?: unknown };
  if (!response.ok) throw new VenueError(acrossErrorMessage(body, response.status));
  return acrossFillState(body.status);
}
