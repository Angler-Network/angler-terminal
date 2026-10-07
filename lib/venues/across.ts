import type { SourceChain } from "./deposits";

/**
 * Across (across.to): the intent bridge Robinhood lists as a partner and Uniswap's own bridging runs on. One deposit
 * on the origin chain, a relayer pays the recipient on the destination chain in seconds, and stablecoins change on
 * the way (USDC on Arbitrum or Base → USDG on Robinhood Chain and back). Mainnet only. The browser reaches it through
 * `app/api/across` (Swap API `/swap/approval`, indexer `/deposit/status`); execution uses the official
 * `@across-protocol/app-sdk`, loaded on demand. Pure, unit-tested.
 */

export interface AcrossQuoteRequest {
  from: SourceChain;
  to: SourceChain;
  /** Input in the origin token's base units (6 decimals for USDC and USDG). */
  units: bigint;
  depositor: `0x${string}`;
  /** Who the relayer pays: the wallet itself or a venue's deposit (intent) address. */
  recipient: `0x${string}`;
  integratorId?: string;
}

export function acrossQuoteParams(request: AcrossQuoteRequest) {
  return {
    tradeType: "exactInput" as const,
    amount: request.units.toString(),
    route: { originChainId: request.from.chainId, inputToken: request.from.usdc, destinationChainId: request.to.chainId, outputToken: request.to.usdc },
    depositor: request.depositor,
    recipient: request.recipient,
    ...(request.integratorId ? { integratorId: request.integratorId } : {}),
  };
}

/** The parts of a `/swap/approval` answer the funds window shows and checks. */
export interface AcrossQuoteShape {
  expectedOutputAmount: string;
  minOutputAmount: string;
  expectedFillTime: number;
  inputAmount: string;
  checks: { balance: { actual: string; expected: string } };
  fees: { total: { amountUsd: string } };
  swapTx?: unknown;
}

export interface AcrossQuoteSummary {
  expectedOut: bigint;
  minOut: bigint;
  feeUsd: number;
  fillSeconds: number;
  /** The wallet holds less of the input token than the deposit takes. */
  shortBalance: boolean;
  /** Across returned no transaction (no route, or the amount is out of bounds). */
  executable: boolean;
}

export function summarizeAcrossQuote(quote: AcrossQuoteShape): AcrossQuoteSummary {
  const feeUsd = Number(quote.fees.total.amountUsd);
  return {
    expectedOut: BigInt(quote.expectedOutputAmount),
    minOut: BigInt(quote.minOutputAmount),
    feeUsd: Number.isFinite(feeUsd) ? Math.max(0, feeUsd) : 0,
    fillSeconds: quote.expectedFillTime,
    shortBalance: BigInt(quote.checks.balance.actual) < BigInt(quote.checks.balance.expected),
    executable: Boolean(quote.swapTx),
  };
}

export type AcrossFillState = "pending" | "filled" | "failed";

/** The indexer's deposit status: `filled` once the relayer paid out; `expired` / `refunded` send funds back on origin. */
export function acrossFillState(status: unknown): AcrossFillState {
  if (status === "filled") return "filled";
  if (status === "expired" || status === "refunded") return "failed";
  return "pending";
}

/** Across errors arrive as `{ type: "AcrossApiError", code, message }`; amounts out of range read as plain advice. */
export function acrossErrorMessage(body: unknown, status: number) {
  const data = (body ?? {}) as { message?: unknown; code?: unknown; error?: unknown };
  const message = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : "";
  if (/amount.*(low|small|minimum)|too low/i.test(message) || data.code === "AMOUNT_TOO_LOW") return "The amount is too small for this route.";
  if (/amount.*(high|large|maximum)|too high/i.test(message) || data.code === "AMOUNT_TOO_HIGH") return "The amount is too large for this route right now.";
  if (/route|not supported|unsupported/i.test(message)) return "Across doesn't support this route right now.";
  return message || `Across responded ${status}.`;
}
