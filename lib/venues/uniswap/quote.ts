/** Uniswap Trading API quote handling: routing, amounts, the integrator fee and errors. Pure, unit-tested. */

/** Routings settled by a transaction the wallet sends (POST /swap). */
const TX_ROUTINGS = new Set(["CLASSIC", "WRAP", "UNWRAP"]);
/** UniswapX: a signed order a filler settles, so the wallet pays no gas (POST /order). */
const ORDER_ROUTINGS = new Set(["DUTCH_V2", "DUTCH_V3", "PRIORITY"]);

export type UniswapRouting = "tx" | "order";

export interface UniswapPermit {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  values: Record<string, unknown>;
}

export interface UniswapQuote {
  /** The API's routing name (CLASSIC, DUTCH_V3…), sent back with an order. */
  routing: string;
  settle: UniswapRouting;
  /** The quote object exactly as received: /swap and /order take it back unchanged. */
  raw: Record<string, unknown>;
  permitData: UniswapPermit | null;
  inAmount: bigint;
  /** What the swapper receives, after our integrator fee. */
  outAmount: bigint;
  /** Lowest output the slippage bound allows, when the quote states it. */
  minOutAmount: bigint | null;
  /** Integrator fee taken from the output, in output token units and in bps. */
  feeAmount: bigint;
  feeBps: number;
  /** Percent, positive is worse; null when the routing doesn't report it (UniswapX). */
  priceImpactPct: number | null;
  /** Gas the wallet pays in USD; 0 for UniswapX orders. */
  gasFeeUsd: number | null;
  /** Pools or protocols the route goes through, for display. */
  route: string[];
  fetchedAt: number;
}

function toBigInt(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  try {
    const amount = BigInt(value);
    return amount >= 0n ? amount : null;
  } catch {
    return null;
  }
}

function toNumber(value: unknown) {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}

function readPermit(value: unknown): UniswapPermit | null {
  if (!value || typeof value !== "object") return null;
  const permit = value as Record<string, unknown>;
  if (!permit.domain || !permit.types || !permit.values) return null;
  return permit as unknown as UniswapPermit;
}

/** Protocols the classic route trades through (V2/V3/V4 pools), deduplicated. */
function routeLabels(quote: Record<string, unknown>, settle: UniswapRouting) {
  if (settle === "order") return ["UniswapX"];
  const legs = Array.isArray(quote.route) ? (quote.route as unknown[]).flat() : [];
  const labels = legs.flatMap((pool) => {
    const type = (pool as { type?: unknown } | null)?.type;
    return typeof type === "string" ? [type.replace(/-pool$/i, "").toUpperCase()] : [];
  });
  return [...new Set(labels)].map((label) => `Uniswap ${label}`);
}

/** Parses a /quote response; null when it can't be executed by the terminal (bridges, chained plans, bad shape). */
export function readUniswapQuote(body: unknown, now = Date.now()): UniswapQuote | null {
  const record = (body ?? {}) as Record<string, unknown>;
  const routing = typeof record.routing === "string" ? record.routing : "";
  const settle: UniswapRouting | null = TX_ROUTINGS.has(routing) ? "tx" : ORDER_ROUTINGS.has(routing) ? "order" : null;
  const raw = record.quote;
  if (!settle || !raw || typeof raw !== "object") return null;
  const quote = raw as Record<string, unknown>;
  const input = (quote.input ?? {}) as Record<string, unknown>;
  const output = (quote.output ?? {}) as Record<string, unknown>;
  const outputs = Array.isArray(quote.aggregatedOutputs) ? (quote.aggregatedOutputs as Array<Record<string, unknown>>) : [];
  const core = outputs.find((entry) => entry && entry.fee !== "INTEGRATOR");
  const fees = outputs.filter((entry) => entry?.fee === "INTEGRATOR");
  const feeAmount = fees.reduce((sum, entry) => sum + (toBigInt(entry.amount) ?? 0n), 0n);
  const feeBps = fees.reduce((sum, entry) => sum + (toNumber(entry.bps) ?? 0), 0);

  const inAmount = toBigInt(quote.expectedAmountIn) ?? toBigInt(input.amount);
  const outAmount = toBigInt(core?.amount) ?? toBigInt(quote.expectedAmountOut) ?? toBigInt(output.amount);
  if (inAmount === null || outAmount === null || outAmount === 0n) return null;
  const impact = toNumber(quote.priceImpact);
  const gas = toNumber(quote.gasFeeUSD);
  return {
    routing,
    settle,
    raw: quote,
    permitData: readPermit(record.permitData),
    inAmount,
    outAmount,
    minOutAmount: toBigInt(core?.minAmount) ?? toBigInt(output.minimumAmount),
    feeAmount,
    feeBps,
    priceImpactPct: impact === null ? null : Math.abs(impact),
    gasFeeUsd: settle === "order" ? 0 : gas,
    route: routeLabels(quote, settle),
    fetchedAt: now,
  };
}

/** The struct the permit signs: the one type no other type refers to (EIP712Domain aside). */
export function permitPrimaryType(types: UniswapPermit["types"]) {
  const names = Object.keys(types).filter((name) => name !== "EIP712Domain");
  const referenced = new Set(names.flatMap((name) => types[name].map((field) => field.type.replace(/\[\]$/, ""))));
  return names.find((name) => !referenced.has(name)) ?? null;
}

/** EIP-712 types without the domain entry, which viem builds itself. */
export function permitTypes(types: UniswapPermit["types"]) {
  return Object.fromEntries(Object.entries(types).filter(([name]) => name !== "EIP712Domain"));
}

/** UniswapX order states: open/unverified keep waiting, filled is done, everything else is final without a fill. */
export function orderOutcome(status: unknown): "pending" | "filled" | "failed" {
  if (status === "filled") return "filled";
  if (status === "open" || status === "unverified" || status === undefined) return "pending";
  return "failed";
}

const ORDER_STATUS_MESSAGES: Record<string, string> = {
  expired: "No filler took the order before it expired. Nothing was spent; try again.",
  cancelled: "The order was cancelled. Nothing was spent.",
  "insufficient-funds": "The wallet no longer had enough balance when the order was filled, so it was cancelled.",
  error: "Uniswap couldn't fill the order. Nothing was spent.",
};

export function orderStatusMessage(status: unknown) {
  return (typeof status === "string" && ORDER_STATUS_MESSAGES[status]) || ORDER_STATUS_MESSAGES.error;
}

/** Readable text for the API's error codes (`errorCode` + `detail`). */
export function uniswapErrorMessage(code: string | undefined, detail: string | undefined, status?: number) {
  if (status === 404 || code === "QuoteNotFound" || code === "ResourceNotFound" || /no quotes? available/i.test(detail ?? "")) {
    return "Uniswap has no route for this swap right now.";
  }
  if (status === 429 || code === "RateLimitExceeded") return "Uniswap is rate limiting requests. Wait a moment and try again.";
  if (status === 401 || code === "Unauthorized") return "Uniswap isn't set up on this site.";
  if (code === "InsufficientBalance" || /insufficient (balance|funds)/i.test(detail ?? "")) return "Not enough balance for this swap.";
  if (status === 503) return detail || "Uniswap isn't available on this site.";
  return detail ? `Uniswap: ${detail}` : "Uniswap request failed.";
}

export interface UniswapTx {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  gas?: bigint;
}

/** A transaction from /check_approval or /swap, checked before the wallet sees it (never sent with empty calldata). */
export function readUniswapTx(value: unknown): UniswapTx | null {
  if (!value || typeof value !== "object") return null;
  const tx = value as Record<string, unknown>;
  if (typeof tx.to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(tx.to)) return null;
  if (typeof tx.data !== "string" || !/^0x[0-9a-fA-F]+$/.test(tx.data) || tx.data.length <= 2) return null;
  const amount = tx.value === undefined || tx.value === null || tx.value === "" ? 0n : toBigInt(tx.value);
  if (amount === null) return null;
  const gas = toBigInt(tx.gasLimit);
  return { to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: amount, ...(gas ? { gas } : {}) };
}

/** Amounts a filled UniswapX order actually settled, summed over its fills; null when the API doesn't say. */
export function settledAmounts(order: unknown) {
  const settled = (order as { settledAmounts?: unknown } | null)?.settledAmounts;
  if (!Array.isArray(settled) || settled.length === 0) return null;
  let amountIn = 0n;
  let amountOut = 0n;
  for (const entry of settled as Array<Record<string, unknown>>) {
    amountIn += toBigInt(entry?.amountIn) ?? 0n;
    amountOut += toBigInt(entry?.amountOut) ?? 0n;
  }
  return amountOut > 0n ? { amountIn, amountOut } : null;
}
