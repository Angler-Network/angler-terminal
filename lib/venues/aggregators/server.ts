import "server-only";
import { NATIVE_TOKEN } from "../uniswap/chains";
import { QUOTE_ONLY_SWAPPER } from "../uniswap/config";
import { lifiFetch, lifiQuoteQuery, readLifiServerConfig } from "../lifi-server";
import type { AggregatorProvider, AggregatorQuoteBody, AggregatorQuoteRequest, GaslessOrder, GaslessSignature, GaslessStatus } from "./types";

/**
 * EVM swap aggregators next to Uniswap: 0x Swap API v2 (allowance-holder) and KyberSwap Aggregator v1 (Odos was
 * removed when it shut down its API). Server only: the API keys and our fee never reach the browser. One fee for both
 * (AGGREGATOR_FEE_BPS to AGGREGATOR_FEE_RECIPIENT), so neither wins a comparison by charging less.
 *
 *   ZEROX_API_KEY         dashboard.0x.org
 *   KYBERSWAP_CLIENT_ID   a name for our app (KyberSwap needs no key; the id turns it on and identifies us)
 *   AGGREGATOR_FEE_BPS, AGGREGATOR_FEE_RECIPIENT
 */

const TIMEOUT_MS = 15_000;
const ZEROX_URL = "https://api.0x.org";
const KYBER_URL = "https://aggregator-api.kyberswap.com";
/** KyberSwap's chain names (aggregator-api.kyberswap.com/{chain}; list: common-service.kyberswap.com/api/v1/aggregator/supported-chains). */
const KYBER_CHAINS: Record<number, string> = {
  1: "ethereum",
  10: "optimism",
  56: "bsc",
  130: "unichain",
  137: "polygon",
  143: "monad",
  59144: "linea",
  146: "sonic",
  80094: "berachain",
  9745: "plasma",
  2020: "ronin",
  4326: "megaeth",
  42793: "etherlink",
  999: "hyperevm",
  4663: "robinhood",
  8453: "base",
  42161: "arbitrum",
  43114: "avalanche",
};
/** 0x and KyberSwap name the native coin this way (the terminal uses the zero address). */
const ZEROX_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const MAX_FEE_BPS = 100;

export function readAggregatorConfig(env: Record<string, string | undefined>) {
  const bps = Number(env.AGGREGATOR_FEE_BPS);
  const recipient = env.AGGREGATOR_FEE_RECIPIENT?.trim() ?? "";
  const fee = Number.isInteger(bps) && bps > 0 && bps <= MAX_FEE_BPS && /^0x[0-9a-fA-F]{40}$/.test(recipient) ? { bps, recipient } : null;
  return { zeroxKey: env.ZEROX_API_KEY?.trim() || null, kyberClientId: env.KYBERSWAP_CLIENT_ID?.trim() || null, fee };
}

type Config = ReturnType<typeof readAggregatorConfig>;

export function aggregatorEnabled(provider: AggregatorProvider, config: Config) {
  // LI.FI needs no key; its integrator and fee come from the LI.FI settings (`lifi-server.ts`).
  return provider === "zerox" ? Boolean(config.zeroxKey) : provider === "kyberswap" ? Boolean(config.kyberClientId) : true;
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

/** DEXes whose own name differs from KyberSwap's id: Aerodrome's concentrated pools are Slipstream, Pancake is PancakeSwap. */
const KYBER_DEX_NAMES: Array<[RegExp, string]> = [
  [/^aerodrome-cl(?:-\d+)?$/, "Aerodrome Slipstream"],
  [/^pancake(?=$|-)/, "PancakeSwap"],
  [/^four-?meme/, "Four.meme"],
];

/** KyberSwap's DEX ids ("pancake-v3", "uniswap-v4") the way the other sources spell DEXes ("PancakeSwap V3"). */
export function kyberExchangeName(exchange: string) {
  const known = KYBER_DEX_NAMES.find(([pattern]) => pattern.test(exchange));
  if (known) {
    const [pattern, name] = known;
    // Keep a version suffix ("pancake-v3" → "PancakeSwap V3"); Slipstream's numbered pools read as one.
    const rest = exchange.replace(pattern, "").replace(/^-/, "");
    return /^v\d+$/i.test(rest) ? `${name} ${rest.toUpperCase()}` : name;
  }
  return exchange
    .replace(/([a-z])(v\d+)$/i, "$1-$2")
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
  const exchanges = [...new Set(hops.map((hop) => String(hop?.exchange ?? "")).filter(Boolean).map(kyberExchangeName))];
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

/** LI.FI's step names that are its own plumbing, not a DEX ("Integrator Fee"). */
const LIFI_PLUMBING = /fee|^li\.?fi/i;

/**
 * LI.FI on one chain (fromChain = toChain): a same-chain swap through whichever DEX aggregator LI.FI picks, for chains
 * no other source here routes. Our integrator name and fee are the LI.FI settings (LIFI_INTEGRATOR, LIFI_FEE_BPS),
 * as for bridging. The quote carries the transaction; `approvalAddress` is the contract to approve.
 */
async function lifiSwap(request: AggregatorQuoteRequest): Promise<AggregatorQuoteBody> {
  const config = readLifiServerConfig(process.env);
  const slippage = (request.slippageBps ?? 50) / 10_000;
  const query = lifiQuoteQuery(
    new URLSearchParams({
      fromChain: String(request.chainId),
      toChain: String(request.chainId),
      fromToken: request.sellToken,
      toToken: request.buyToken,
      fromAmount: request.sellAmount,
      fromAddress: request.taker ?? QUOTE_ONLY_SWAPPER,
      toAddress: request.taker ?? QUOTE_ONLY_SWAPPER,
      slippage: String(slippage),
    }),
    config,
  );
  if (!query) throw new Error("LI.FI has no route for this swap.");
  const response = await lifiFetch(`/quote?${query}`, config.apiKey);
  const body = await json(response);
  const estimate = (body.estimate ?? {}) as Record<string, unknown>;
  const outAmount = big(estimate.toAmount);
  if (!response.ok || !outAmount) throw new Error(typeof body.message === "string" ? body.message : "LI.FI has no route for this swap.");
  const request_ = (body.transactionRequest ?? {}) as Record<string, unknown>;
  // LI.FI sends value and gas as hex.
  const tx =
    typeof request_.to === "string" && typeof request_.data === "string"
      ? { to: request_.to, data: request_.data, value: (big(request_.value) ?? 0n).toString(), gas: big(request_.gasLimit)?.toString() }
      : undefined;
  const steps = Array.isArray(body.includedSteps) ? (body.includedSteps as Array<{ toolDetails?: { name?: unknown } }>) : [];
  const route = [...new Set(steps.map((step) => String(step.toolDetails?.name ?? "")).filter((name) => name && !LIFI_PLUMBING.test(name)))];
  const inUsd = Number(estimate.fromAmountUSD);
  const outUsd = Number(estimate.toAmountUSD);
  return {
    provider: "lifi",
    outAmount: outAmount.toString(),
    minOutAmount: big(estimate.toAmountMin)?.toString() ?? null,
    feeBps: config.fee ? Math.round(Number(config.fee) * 10_000) : 0,
    // USD in vs out: the price impact plus the fees, so the impact guard errs on the safe side.
    priceImpactPct: inUsd > 0 && outUsd > 0 ? Math.max(0, ((inUsd - outUsd) / inUsd) * 100) : null,
    gasFeeUsd: Array.isArray(estimate.gasCosts) ? (estimate.gasCosts as Array<{ amountUSD?: unknown }>).reduce((sum, cost) => sum + (Number(cost.amountUSD) || 0), 0) : null,
    route: route.slice(0, 4),
    // Only a firm quote for the wallet carries a transaction to send.
    tx: request.execute && request.taker ? tx : undefined,
    allowanceTarget: typeof estimate.approvalAddress === "string" ? estimate.approvalAddress : undefined,
  };
}

/**
 * 0x Gasless API (same key and fee as the Swap API): price-only quotes for the card, a firm quote with the EIP-712
 * payloads for the wallet, then submit and status. 0x's relayer sends the transaction and takes the gas from the
 * swap, so the wallet needs no native coin. Selling the native coin isn't supported (it has nothing to sign over).
 */
const zeroxHeaders = (config: Config) => ({ "0x-api-key": config.zeroxKey!, "0x-version": "v2" });

export async function zeroxGaslessQuote(request: AggregatorQuoteRequest, config: Config): Promise<AggregatorQuoteBody> {
  if (request.sellToken === NATIVE_TOKEN) throw new Error("Gasless swaps can't sell the native coin: pick a token to sell.");
  const firm = Boolean(request.execute && request.taker);
  const params = new URLSearchParams({
    chainId: String(request.chainId),
    sellToken: request.sellToken,
    buyToken: request.buyToken === NATIVE_TOKEN ? ZEROX_NATIVE : request.buyToken,
    sellAmount: request.sellAmount,
    taker: request.taker ?? QUOTE_ONLY_SWAPPER,
    slippageBps: String(request.slippageBps ?? 50),
  });
  if (config.fee) {
    params.set("swapFeeRecipient", config.fee.recipient);
    params.set("swapFeeBps", String(config.fee.bps));
    params.set("swapFeeToken", params.get("buyToken")!);
  }
  const response = await fetch(`${ZEROX_URL}/gasless/${firm ? "quote" : "price"}?${params}`, {
    headers: zeroxHeaders(config),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await json(response);
  if (!response.ok || body.liquidityAvailable === false) throw new Error(typeof body.message === "string" ? body.message : "0x Gasless has no route for this swap.");
  const outAmount = big(body.buyAmount);
  if (!outAmount) throw new Error("0x sent a gasless quote this terminal can't read.");
  const issues = (body.issues ?? {}) as { allowance?: { spender?: unknown } | null };
  const fills = ((body.route as { fills?: Array<{ source?: unknown }> } | undefined)?.fills ?? []).map((fill) => String(fill.source ?? "")).filter(Boolean);
  const trade = body.trade as GaslessOrder["trade"] | undefined;
  const approval = (body.approval ?? null) as GaslessOrder["approval"];
  return {
    provider: "zerox",
    outAmount: outAmount.toString(),
    minOutAmount: big(body.minBuyAmount)?.toString() ?? null,
    feeBps: config.fee?.bps ?? 0,
    // The relayer's gas comes out of the swap (in the buy token), already in buyAmount: nothing for the wallet to pay.
    gasFeeUsd: null,
    route: [...new Set(fills)].slice(0, 4),
    allowanceTarget: typeof issues.allowance?.spender === "string" ? issues.allowance.spender : undefined,
    gasless: firm && trade?.eip712 ? { trade, approval: approval?.eip712 ? approval : null, approvalNeeded: Boolean(issues.allowance) } : undefined,
  };
}

export interface GaslessSubmitRequest {
  chainId: number;
  trade: GaslessOrder["trade"] & { signature: GaslessSignature };
  approval?: (NonNullable<GaslessOrder["approval"]> & { signature: GaslessSignature }) | null;
}

/** Hands the signed trade (and approval) to 0x's relayer; answers the trade hash to follow. */
export async function zeroxGaslessSubmit(request: GaslessSubmitRequest, config: Config) {
  const response = await fetch(`${ZEROX_URL}/gasless/submit`, {
    method: "POST",
    headers: { ...zeroxHeaders(config), "content-type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({ chainId: request.chainId, trade: request.trade, ...(request.approval ? { approval: request.approval } : {}) }),
  });
  const body = await json(response);
  if (!response.ok || typeof body.tradeHash !== "string") throw new Error(typeof body.message === "string" ? body.message : "0x didn't accept the gasless swap.");
  return { tradeHash: body.tradeHash };
}

const GASLESS_STATUSES = new Set(["pending", "submitted", "succeeded", "confirmed", "failed"]);

export async function zeroxGaslessStatus(tradeHash: string, chainId: number, config: Config): Promise<GaslessStatus> {
  const response = await fetch(`${ZEROX_URL}/gasless/status/${tradeHash}?chainId=${chainId}`, { headers: zeroxHeaders(config), cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await json(response);
  if (!response.ok || typeof body.status !== "string" || !GASLESS_STATUSES.has(body.status)) throw new Error("0x couldn't report the gasless swap's status.");
  const transactions = Array.isArray(body.transactions) ? (body.transactions as Array<{ hash?: unknown }>) : [];
  const last = transactions.at(-1)?.hash;
  return { status: body.status as GaslessStatus["status"], txHash: typeof last === "string" ? last : null, reason: typeof body.reason === "string" ? body.reason : null };
}

export function quoteAggregator(request: AggregatorQuoteRequest, config: Config) {
  return request.provider === "zerox" ? zerox(request, config) : request.provider === "kyberswap" ? kyberswap(request, config) : lifiSwap(request);
}
