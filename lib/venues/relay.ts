import type { AcrossQuoteRequest, AcrossQuoteSummary } from "./across";

/**
 * Relay (relay.link): a second cross-chain route next to Across. One quote (`POST /quote`) returns the transactions to
 * send on the origin chain (an approval when needed, then the deposit); a solver pays the recipient on the
 * destination and `/intents/status/v2` follows the request. No key needed; our fee is an app fee in bps of the input
 * that the server adds (`relay-server.ts`). Every bridge leg asks both and takes the larger output (`bridge-leg.ts`).
 * Pure, unit-tested.
 */

export interface RelayTx {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  chainId: number;
  gas?: bigint;
}

export interface RelayQuote extends AcrossQuoteSummary {
  requestId: string;
  /** Transactions to send on the origin chain, in order. */
  txs: RelayTx[];
}

export function relayQuoteBody(request: AcrossQuoteRequest) {
  return relaySwapBody({
    user: request.depositor,
    recipient: request.recipient,
    originChainId: request.from.chainId,
    destinationChainId: request.to.chainId,
    originCurrency: request.from.usdc,
    destinationCurrency: request.to.usdc,
    amount: request.units,
  });
}

/** Any token to any token across chains in one quote (the swap card's cross-chain swaps); native ETH is the zero address. */
export interface RelaySwapRequest {
  user: string;
  recipient: string;
  originChainId: number;
  destinationChainId: number;
  originCurrency: string;
  destinationCurrency: string;
  amount: bigint;
}

export function relaySwapBody(request: RelaySwapRequest) {
  return { ...request, amount: request.amount.toString(), tradeType: "EXACT_INPUT" };
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

function readTx(value: unknown): RelayTx | null {
  const tx = (value ?? {}) as Record<string, unknown>;
  if (typeof tx.to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(tx.to)) return null;
  if (typeof tx.data !== "string" || !/^0x[0-9a-fA-F]+$/.test(tx.data) || tx.data.length <= 2) return null;
  const value_ = tx.value === undefined || tx.value === null || tx.value === "" ? 0n : amount(tx.value);
  if (value_ === null || typeof tx.chainId !== "number") return null;
  const gas = amount(tx.gas);
  return { to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: value_, chainId: tx.chainId, ...(gas ? { gas } : {}) };
}

/**
 * A `/quote` answer in the bridge legs' shared shape. Only transaction steps the browser can send are kept; a quote
 * asking for a signature step, or with no deposit, isn't executable. The fee is everything the route costs in USD
 * (Relay's `totalImpact`: gas, relayer and our app fee).
 */
export function readRelayQuote(body: unknown, originChainId: number): RelayQuote | null {
  const record = (body ?? {}) as { steps?: unknown; details?: Record<string, unknown> };
  const details = record.details ?? {};
  const out = amount((details.currencyOut as { amount?: unknown } | undefined)?.amount);
  if (out === null || !Array.isArray(record.steps)) return null;
  const minOut = amount((details.currencyOut as { minimumAmount?: unknown } | undefined)?.minimumAmount) ?? out;
  let requestId = "";
  const txs: RelayTx[] = [];
  let executable = record.steps.length > 0;
  for (const step of record.steps as Array<Record<string, unknown>>) {
    if (step?.kind !== "transaction" || !Array.isArray(step.items)) {
      executable = false;
      continue;
    }
    if (typeof step.requestId === "string") requestId ||= step.requestId;
    for (const item of step.items as Array<Record<string, unknown>>) {
      if (item?.status === "complete") continue;
      const tx = readTx(item?.data);
      if (!tx || tx.chainId !== originChainId) executable = false;
      else txs.push(tx);
    }
  }
  if (!requestId || txs.length === 0) executable = false;
  const impact = Number((details.totalImpact as { usd?: unknown } | undefined)?.usd);
  const seconds = Number(details.timeEstimate);
  return {
    requestId,
    txs,
    expectedOut: out,
    minOut,
    feeUsd: Number.isFinite(impact) ? Math.max(0, -impact) : 0,
    fillSeconds: Number.isFinite(seconds) ? seconds : 0,
    shortBalance: false,
    executable,
  };
}

export type RelayFillState = "pending" | "filled" | "failed";

/** `/intents/status/v2`: success once the solver paid; refund / failure send the input back on the origin chain. */
export function relayFillState(status: unknown): RelayFillState {
  if (status === "success") return "filled";
  if (status === "failure" || status === "refund" || status === "refunded") return "failed";
  return "pending";
}

export function relayErrorMessage(body: unknown, status: number) {
  const data = (body ?? {}) as { message?: unknown; errorCode?: unknown };
  const message = typeof data.message === "string" ? data.message : "";
  if (data.errorCode === "AMOUNT_TOO_LOW" || /too (low|small)/i.test(message)) return "The amount is too small for this route.";
  if (/no routes?|not supported|unsupported/i.test(message)) return "Relay doesn't support this route right now.";
  return message || `Relay responded ${status}.`;
}
