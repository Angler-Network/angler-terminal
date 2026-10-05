import type { SpotQuote, SpotToken } from "../types";
import { orderErrorMessage } from "./errors";

/** GET /swap/v2/order response fields the terminal reads. */
export interface JupOrderResponse {
  requestId?: string;
  inAmount?: string;
  outAmount?: string;
  otherAmountThreshold?: string;
  slippageBps?: number;
  priceImpact?: number;
  feeBps?: number;
  feeMint?: string;
  signatureFeeLamports?: number;
  signatureFeePayer?: string;
  prioritizationFeeLamports?: number;
  prioritizationFeePayer?: string;
  rentFeeLamports?: number;
  rentFeePayer?: string;
  inUsdValue?: number;
  outUsdValue?: number;
  router?: string;
  transaction?: string | null;
  taker?: string;
  errorCode?: number;
  errorMessage?: string;
  error?: string;
}

function big(value: string | undefined) {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

/** Network fees the taker pays (gasless or integrator-paid parts are excluded). */
function takerLamports(order: JupOrderResponse) {
  const parts: Array<[number | undefined, string | undefined]> = [
    [order.signatureFeeLamports, order.signatureFeePayer],
    [order.prioritizationFeeLamports, order.prioritizationFeePayer],
    [order.rentFeeLamports, order.rentFeePayer],
  ];
  return parts.reduce((sum, [lamports, payer]) => (lamports && (!payer || !order.taker || payer === order.taker) ? sum + lamports : sum), 0);
}

export function toSpotQuote(order: JupOrderResponse, inputToken: SpotToken, outputToken: SpotToken, now = Date.now()): SpotQuote {
  const hasTransaction = typeof order.transaction === "string" && order.transaction.length > 0;
  const error =
    order.transaction === ""
      ? orderErrorMessage(order.router, order.errorCode, order.errorMessage ?? order.error)
      : !order.requestId
        ? order.errorMessage ?? order.error ?? "No route found for this swap."
        : undefined;
  return {
    requestId: order.requestId ?? "",
    inputToken,
    outputToken,
    inAmount: big(order.inAmount),
    outAmount: big(order.outAmount),
    minOutAmount: big(order.otherAmountThreshold),
    slippageBps: order.slippageBps ?? 0,
    priceImpactPct: order.priceImpact ?? 0,
    feeBps: order.feeBps ?? 0,
    feeMint: order.feeMint,
    networkFeeLamports: takerLamports(order),
    inUsdValue: order.inUsdValue,
    outUsdValue: order.outUsdValue,
    router: order.router,
    transaction: hasTransaction ? order.transaction! : null,
    error,
    fetchedAt: now,
  };
}
