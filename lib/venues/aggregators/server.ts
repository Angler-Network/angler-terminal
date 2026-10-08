import "server-only";
import { NATIVE_TOKEN } from "../uniswap/chains";
import { QUOTE_ONLY_SWAPPER } from "../uniswap/config";
import type { AggregatorProvider, AggregatorQuoteBody, AggregatorQuoteRequest } from "./types";

/**
 * EVM swap aggregators next to Uniswap: 0x Swap API v2 (allowance-holder), Odos SOR v3 and KyberSwap Aggregator v1.
 * Server only: the API keys and our fee never reach the browser. One fee for all (AGGREGATOR_FEE_BPS to
 * AGGREGATOR_FEE_RECIPIENT), so none wins a comparison by charging less; Odos keeps 20% of it, KyberSwap none.
 *
 *   ZEROX_API_KEY         dashboard.0x.org
 *   ODOS_API_KEY          Odos enterprise API (partner fees need it)
 *   KYBERSWAP_CLIENT_ID   a name for our app (KyberSwap needs no key; the id turns it on and identifies us)
 *   AGGREGATOR_FEE_BPS, AGGREGATOR_FEE_RECIPIENT
 */

const TIMEOUT_MS = 15_000;
const ZEROX_URL = "https://api.0x.org";
const ODOS_URL = "https://enterprise-api.odos.xyz";
const KYBER_URL = "https://aggregator-api.kyberswap.com";
/** KyberSwap's chain names (aggregator-api.kyberswap.com/{chain}); Robinhood Chain isn't one. */
const KYBER_CHAINS: Record<number, string> = { 1: "ethereum", 56: "bsc", 8453: "base", 42161: "arbitrum" };
/** 0x and KyberSwap name the native coin this way; Odos uses the zero address like the terminal. */
const ZEROX_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const MAX_FEE_BPS = 100;

export function readAggregatorConfig(env: Record<string, string | undefined>) {
  const bps = Number(env.AGGREGATOR_FEE_BPS);
  const recipient = env.AGGREGATOR_FEE_RECIPIENT?.trim() ?? "";
  const fee = Number.isInteger(bps) && bps > 0 && bps <= MAX_FEE_BPS && /^0x[0-9a-fA-F]{40}$/.test(recipient) ? { bps, recipient } : null;
  return { zeroxKey: env.ZEROX_API_KEY?.trim() || null, odosKey: env.ODOS_API_KEY?.trim() || null, kyberClientId: env.KYBERSWAP_CLIENT_ID?.trim() || null, fee };
}

type Config = ReturnType<typeof readAggregatorConfig>;

export function aggregatorEnabled(provider: AggregatorProvider, config: Config) {
  return provider === "zerox" ? Boolean(config.zeroxKey) : provider === "odos" ? Boolean(config.odosKey) : Boolean(config.kyberClientId);
}

async function json(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

const big = (value: unknown) => {
  try {
    return typeof value === "string" || typeof value === "number" ? BigInt(value) : null;
  } catch {
    return null;
  }
};

function readTx(raw: unknown) {
  const tx = (raw ?? {}) as Record<string, unknown>;
  if (typeof tx.to !== "string" || typeof tx.data !== "string") return undefined;
  return { to: tx.to, data: tx.data, value: String(tx.value ?? "0"), gas: tx.gas != null ? String(tx.gas) : undefined };
}

async function zerox(request: AggregatorQuoteRequest, config: Config): Promise<AggregatorQuoteBody> {
  const native = (address: string) => (address === NATIVE_TOKEN ? ZEROX_NATIVE : address);
  const params = new URLSearchParams({
    chainId: String(request.chainId),
    sellToken: native(request.sellToken),
    buyToken: native(request.buyToken),
    sellAmount: request.sellAmount,
    taker: request.taker ?? QUOTE_ONLY_SWAPPER,
    slippageBps: String(request.slippageBps ?? 50),
  });
  if (config.fee) {
    params.set("swapFeeRecipient", config.fee.recipient);
    params.set("swapFeeBps", String(config.fee.bps));
    params.set("swapFeeToken", native(request.buyToken));
  }
  // A price is enough to compare; the firm quote (with the transaction) only right before signing.
  const path = request.execute && request.taker ? "quote" : "price";
  const response = await fetch(`${ZEROX_URL}/swap/allowance-holder/${path}?${params}`, {
    headers: { "0x-api-key": config.zeroxKey!, "0x-version": "v2" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await json(response);
  if (!response.ok || body.liquidityAvailable === false) throw new Error(typeof body.message === "string" ? body.message : "0x has no route for this swap.");
  const outAmount = big(body.buyAmount);
  if (!outAmount) throw new Error("0x sent a quote this terminal can't read.");
  const issues = (body.issues ?? {}) as { allowance?: { spender?: unknown } | null };
  const fills = ((body.route as { fills?: Array<{ source?: unknown }> } | undefined)?.fills ?? []).map((fill) => String(fill.source ?? "")).filter(Boolean);
  return {
    provider: "zerox",
    outAmount: outAmount.toString(),
    minOutAmount: big(body.minBuyAmount)?.toString() ?? null,
    feeBps: config.fee?.bps ?? 0,
    route: [...new Set(fills)].slice(0, 4),
    tx: readTx(body.transaction),
    allowanceTarget: typeof issues.allowance?.spender === "string" ? issues.allowance.spender : typeof body.allowanceTarget === "string" ? body.allowanceTarget : undefined,
  };
}

async function odos(request: AggregatorQuoteRequest, config: Config): Promise<AggregatorQuoteBody> {
  const headers = { "content-type": "application/json", "x-api-key": config.odosKey! };
  const userAddr = request.taker ?? QUOTE_ONLY_SWAPPER;
  const slippagePct = (request.slippageBps ?? 50) / 100;
  const quoteResponse = await fetch(`${ODOS_URL}/sor/quote/v3`, {
    method: "POST",
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      chainId: request.chainId,
      inputTokens: [{ tokenAddress: request.sellToken, amount: request.sellAmount }],
      outputTokens: [{ tokenAddress: request.buyToken, proportion: 1 }],
      userAddr,
      slippageLimitPercent: slippagePct,
      compact: true,
      ...(config.fee ? { partnerFeePercent: config.fee.bps / 10_000, feeRecipient: config.fee.recipient } : {}),
    }),
  });
  const quote = await json(quoteResponse);
  const outAmount = big((quote.outAmounts as unknown[] | undefined)?.[0]);
  if (!quoteResponse.ok || !outAmount || typeof quote.pathId !== "string") throw new Error(typeof quote.detail === "string" ? quote.detail : "Odos has no route for this swap.");
  const minOut = (outAmount * BigInt(Math.round((100 - slippagePct) * 100))) / 10_000n;
  const priceImpact = Number(quote.priceImpact);
  let tx: AggregatorQuoteBody["tx"];
  if (request.execute && request.taker) {
    const assembleResponse = await fetch(`${ODOS_URL}/sor/assemble`, {
      method: "POST",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ userAddr, pathId: quote.pathId, simulate: false }),
    });
    const assembled = await json(assembleResponse);
    tx = readTx(assembled.transaction);
    if (!assembleResponse.ok || !tx) throw new Error("Odos couldn't build the swap transaction.");
  }
  return {
    provider: "odos",
    outAmount: outAmount.toString(),
    minOutAmount: minOut.toString(),
    feeBps: config.fee?.bps ?? 0,
    priceImpactPct: Number.isFinite(priceImpact) ? Math.abs(priceImpact) : null,
    gasFeeUsd: Number.isFinite(Number(quote.gasEstimateValue)) ? Number(quote.gasEstimateValue) : null,
    route: ["Odos"],
    // Odos routes through its router: that's the contract to approve.
    tx,
    allowanceTarget: tx?.to,
  };
}

/** KyberSwap's DEX ids ("pancake-v3", "uniswap-v4") the way the other sources spell DEXes ("Pancake V3"). */
export function kyberExchangeName(exchange: string) {
  return exchange
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => (/^v\d+$/i.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

/**
 * KyberSwap: GET routes (our fee rides in the route as `extraFee`, taken from the output), then POST route/build for
 * the transaction right before signing. Its router is the contract to approve.
 */
async function kyberswap(request: AggregatorQuoteRequest, config: Config): Promise<AggregatorQuoteBody> {
  const chain = KYBER_CHAINS[request.chainId];
  if (!chain) throw new Error("KyberSwap doesn't trade on this chain.");
  const native = (address: string) => (address === NATIVE_TOKEN ? ZEROX_NATIVE : address);
  const headers = { "x-client-id": config.kyberClientId!, accept: "application/json" };
  const params = new URLSearchParams({ tokenIn: native(request.sellToken), tokenOut: native(request.buyToken), amountIn: request.sellAmount, gasInclude: "true" });
  if (config.fee) {
    params.set("feeAmount", String(config.fee.bps));
    params.set("isInBps", "true");
    params.set("chargeFeeBy", "currency_out");
    params.set("feeReceiver", config.fee.recipient);
  }
  const routesResponse = await fetch(`${KYBER_URL}/${chain}/api/v1/routes?${params}`, { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const routes = await json(routesResponse);
  const data = (routes.data ?? {}) as { routeSummary?: Record<string, unknown>; routerAddress?: unknown };
  const summary = data.routeSummary;
  const quoted = big(summary?.amountOut);
  if (!routesResponse.ok || routes.code !== 0 || !summary || !quoted) throw new Error(typeof routes.message === "string" ? routes.message : "KyberSwap has no route for this swap.");

  const slippageBps = request.slippageBps ?? 50;
  let outAmount = quoted;
  let tx: AggregatorQuoteBody["tx"];
  if (request.execute && request.taker) {
    const buildResponse = await fetch(`${KYBER_URL}/${chain}/api/v1/route/build`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ routeSummary: summary, sender: request.taker, recipient: request.taker, slippageTolerance: slippageBps, source: config.kyberClientId }),
    });
    const built = await json(buildResponse);
    const result = (built.data ?? {}) as Record<string, unknown>;
    if (!buildResponse.ok || built.code !== 0 || typeof result.data !== "string" || typeof result.routerAddress !== "string") {
      throw new Error(typeof built.message === "string" ? built.message : "KyberSwap couldn't build the swap transaction.");
    }
    outAmount = big(result.amountOut) ?? quoted;
    tx = { to: result.routerAddress, data: result.data, value: String(result.transactionValue ?? "0"), gas: result.gas != null ? String(result.gas) : undefined };
  }
  const inUsd = Number(summary.amountInUsd);
  const outUsd = Number(summary.amountOutUsd);
  const hops = Array.isArray(summary.route) ? (summary.route as Array<Array<{ exchange?: unknown }>>).flat() : [];
  const exchanges = [...new Set(hops.map((hop) => String(hop?.exchange ?? "")).filter(Boolean))].map(kyberExchangeName);
  return {
    provider: "kyberswap",
    outAmount: outAmount.toString(),
    minOutAmount: ((outAmount * BigInt(10_000 - slippageBps)) / 10_000n).toString(),
    feeBps: config.fee?.bps ?? 0,
    // USD in vs out: the price impact plus our fee, so the impact guard errs on the safe side.
    priceImpactPct: inUsd > 0 && outUsd > 0 ? Math.max(0, ((inUsd - outUsd) / inUsd) * 100) : null,
    gasFeeUsd: Number.isFinite(Number(summary.gasUsd)) ? Number(summary.gasUsd) : null,
    route: exchanges.slice(0, 4),
    tx,
    allowanceTarget: tx?.to ?? (typeof data.routerAddress === "string" ? data.routerAddress : undefined),
  };
}

export function quoteAggregator(request: AggregatorQuoteRequest, config: Config) {
  return request.provider === "zerox" ? zerox(request, config) : request.provider === "odos" ? odos(request, config) : kyberswap(request, config);
}
