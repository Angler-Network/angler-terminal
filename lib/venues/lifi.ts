import type { AcrossQuoteSummary } from "./across";

/**
 * LI.FI (li.quest): an aggregator of bridges and DEXs, the third cross-chain route next to Across and Relay. One
 * `GET /v1/quote` returns the best route it found as a single transaction on the origin chain (EVM: an approval to
 * `approvalAddress` when needed, then `transactionRequest`; Solana: a base64 versioned transaction to sign), and
 * `GET /v1/status` follows it by the origin tx hash. No key needed; the server adds our integrator name and fee
 * (`lifi-server.ts`). Pure, unit-tested.
 */

/** LI.FI's id for Solana, and the address it gives native SOL. */
export const LIFI_SOLANA_CHAIN = 1151111081099710;
export const LIFI_NATIVE_SOL = "11111111111111111111111111111111";

export interface LifiQuoteRequest {
  fromChain: number;
  toChain: number;
  /** Token addresses: 0x… on EVM (native ETH is the zero address), base58 mints on Solana. */
  fromToken: string;
  toToken: string;
  fromAmount: bigint;
  fromAddress: string;
  toAddress: string;
  /** Max slippage as bps; LI.FI's default (0.5%) when unset. */
  slippageBps?: number | null;
  /** LI.FI tools to leave out (the first route's bridge, for an alternative). */
  denyBridges?: string[];
}

export type LifiTx =
  | { kind: "evm"; chainId: number; to: `0x${string}`; data: `0x${string}`; value: bigint; gas?: bigint }
  | { kind: "solana"; data: string };

export interface LifiQuote extends AcrossQuoteSummary {
  /** The bridge or DEX LI.FI picked ("across", "mayan"…), for the route line. */
  tool: string;
  toolName: string;
  /** Destination chain (LI.FI ids: Solana is `LIFI_SOLANA_CHAIN`), for the status poll. */
  toChainId: number;
  /** ERC-20 approval the transaction needs (null for native tokens and Solana). */
  approval: { token: `0x${string}`; spender: `0x${string}` } | null;
  tx: LifiTx | null;
}

/** The query string the browser sends to `/api/lifi/quote` (integrator and fee are added by the server). */
export function lifiQuoteParams(request: LifiQuoteRequest) {
  const params = new URLSearchParams({
    fromChain: String(request.fromChain),
    toChain: String(request.toChain),
    fromToken: request.fromToken,
    toToken: request.toToken,
    fromAmount: request.fromAmount.toString(),
    fromAddress: request.fromAddress,
    toAddress: request.toAddress,
  });
  if (request.slippageBps) params.set("slippage", String(request.slippageBps / 10_000));
  if (request.denyBridges?.length) params.set("denyBridges", request.denyBridges.join(","));
  return params;
}

const amount = (value: unknown) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
};

const isEvmAddress = (value: unknown): value is `0x${string}` => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
const NATIVE_EVM = /^0x0{40}$|^0xe{40}$/i;

function readTx(value: unknown, originChainId: number): LifiTx | null {
  const tx = (value ?? {}) as Record<string, unknown>;
  if (originChainId === LIFI_SOLANA_CHAIN) return typeof tx.data === "string" && /^[A-Za-z0-9+/]+=*$/.test(tx.data) ? { kind: "solana", data: tx.data } : null;
  if (!isEvmAddress(tx.to) || typeof tx.data !== "string" || !/^0x[0-9a-fA-F]+$/.test(tx.data) || tx.data.length <= 2) return null;
  if (Number(tx.chainId) !== originChainId) return null;
  const value_ = tx.value === undefined || tx.value === null || tx.value === "" ? 0n : amount(tx.value);
  if (value_ === null) return null;
  const gas = amount(tx.gasLimit);
  return { kind: "evm", chainId: originChainId, to: tx.to, data: tx.data as `0x${string}`, value: value_, ...(gas ? { gas } : {}) };
}

/**
 * A `/v1/quote` answer in the bridge legs' shared shape. The fee is what the route costs in USD (input value minus
 * output value: LI.FI's own fee, the bridge's, gas paid in the token and ours); the gas the wallet pays isn't in it.
 */
export function readLifiQuote(body: unknown, originChainId: number): LifiQuote | null {
  const record = (body ?? {}) as { tool?: unknown; toolDetails?: { name?: unknown }; estimate?: Record<string, unknown>; action?: Record<string, unknown>; transactionRequest?: unknown };
  const estimate = record.estimate;
  if (!estimate) return null;
  const out = amount(estimate.toAmount);
  if (out === null) return null;
  const minOut = amount(estimate.toAmountMin) ?? out;
  const tx = readTx(record.transactionRequest, originChainId);
  const fromToken = (record.action?.fromToken as { address?: unknown } | undefined)?.address;
  const spender = estimate.approvalAddress;
  const approval =
    tx?.kind === "evm" && isEvmAddress(fromToken) && !NATIVE_EVM.test(fromToken) && isEvmAddress(spender) && estimate.skipApproval !== true
      ? { token: fromToken, spender }
      : null;
  const fromUsd = Number(estimate.fromAmountUSD);
  const toUsd = Number(estimate.toAmountUSD);
  const fees = Array.isArray(estimate.feeCosts) ? (estimate.feeCosts as Array<{ amountUSD?: unknown }>).reduce((sum, fee) => sum + (Number(fee.amountUSD) || 0), 0) : 0;
  const seconds = Number(estimate.executionDuration);
  const tool = typeof record.tool === "string" ? record.tool : "lifi";
  return {
    tool,
    toolName: typeof record.toolDetails?.name === "string" ? record.toolDetails.name : tool,
    toChainId: Number(record.action?.toChainId) || 0,
    approval,
    tx,
    expectedOut: out,
    minOut,
    feeUsd: Number.isFinite(fromUsd) && Number.isFinite(toUsd) && fromUsd > 0 ? Math.max(0, fromUsd - toUsd) : fees,
    fillSeconds: Number.isFinite(seconds) ? seconds : 0,
    shortBalance: false,
    executable: tx !== null && out > 0n,
  };
}

export type LifiFillState = "pending" | "filled" | "failed";

/**
 * `/v1/status`: DONE is filled (PARTIAL means the user got a different token on the destination, still delivered),
 * except REFUNDED; FAILED is failed; NOT_FOUND and PENDING keep waiting.
 */
export function lifiFillState(body: unknown): LifiFillState {
  const record = (body ?? {}) as { status?: unknown; substatus?: unknown };
  if (record.status === "DONE") return record.substatus === "REFUNDED" ? "failed" : "filled";
  if (record.status === "FAILED" || record.status === "INVALID") return "failed";
  return "pending";
}

export function lifiErrorMessage(body: unknown, status: number) {
  const data = (body ?? {}) as { message?: unknown; code?: unknown };
  const message = typeof data.message === "string" ? data.message : "";
  if (status === 404 || data.code === 1002 || /no (available )?(quotes?|routes?)/i.test(message)) return "LI.FI has no route for this swap right now.";
  if (/too (low|small)|minimum/i.test(message)) return "The amount is too small for this route.";
  if (status === 429) return "LI.FI is busy right now. Try again in a moment.";
  return message || `LI.FI responded ${status}.`;
}
