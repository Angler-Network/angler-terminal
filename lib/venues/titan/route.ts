/**
 * Titan Portal quote handling (GET /api/v1/quote/swap). Pure, unit-tested. Docs:
 * https://titan-exchange.gitbook.io/titan/developer-doc/developers-portal/quickstart.md
 */

/** Instruction in Titan's short form: p = program id, a = accounts ({ p, s: signer, w: writable }), d = base64 data. */
export interface TitanInstruction {
  p: string;
  a: Array<{ p: string; s: boolean; w: boolean }>;
  d: string;
}

export interface TitanRoute {
  provider: string;
  quoteId: string;
  inAmount: bigint;
  outAmount: bigint;
  slippageBps: number;
  minOutAmount: bigint;
  /** Percent, positive is worse; from the USD prices in metadata, null when Titan sent none. */
  priceImpactPct: number | null;
  inUsdValue?: number;
  outUsdValue?: number;
  instructions: TitanInstruction[];
  /** Lookup tables this route uses, with their addresses (from includeAltContents). */
  lookupTables: Array<{ key: string; addresses: string[] }>;
  computeUnitsSafe: number;
  expiresAtMs?: number;
}

function big(value: unknown) {
  const text = typeof value === "number" ? value.toFixed(0) : typeof value === "string" ? value : "";
  return /^\d+$/.test(text) ? BigInt(text) : 0n;
}

function readInstruction(value: unknown): TitanInstruction | null {
  const record = value as Partial<TitanInstruction> | null;
  if (!record || typeof record.p !== "string" || typeof record.d !== "string" || !Array.isArray(record.a)) return null;
  return { p: record.p, d: record.d, a: record.a.map((key) => ({ p: String(key.p), s: key.s === true, w: key.w === true })) };
}

/** The route Titan recommends (metadata.ExpectedWinner, which weighs simulation results), else the best output. */
export function readTitanRoute(body: unknown): TitanRoute | null {
  const record = (body ?? {}) as Record<string, unknown>;
  const quotes = (record.quotes ?? {}) as Record<string, Record<string, unknown>>;
  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  const providers = Object.keys(quotes);
  if (providers.length === 0) return null;
  const winner = [metadata.ExpectedWinner, metadata.expectedWinner].find((name): name is string => typeof name === "string" && name in quotes);
  const provider = winner ?? providers.sort((a, b) => (big(quotes[b].outAmount) > big(quotes[a].outAmount) ? 1 : -1))[0];
  const route = quotes[provider];
  const instructions = (Array.isArray(route.instructions) ? route.instructions : []).map(readInstruction);
  if (instructions.length === 0 || instructions.some((instruction) => !instruction)) return null;

  const inAmount = big(route.inAmount);
  const outAmount = big(route.outAmount);
  const slippageBps = Number(route.slippageBps) || 0;
  const used = new Set(Array.isArray(route.addressLookupTables) ? route.addressLookupTables.map(String) : []);
  const alts = Array.isArray(record.alts) ? (record.alts as Array<{ p?: unknown; a?: unknown }>) : [];
  const lookupTables = alts
    .filter((table) => typeof table.p === "string" && used.has(table.p) && Array.isArray(table.a))
    .map((table) => ({ key: table.p as string, addresses: (table.a as unknown[]).map(String) }));

  const inDecimals = Number(metadata.inputMintDecimals);
  const outDecimals = Number(metadata.outputMintDecimals);
  const inPrice = Number(metadata.inputPriceUSD);
  const outPrice = Number(metadata.outputPriceUSD);
  const hasPrices = [inDecimals, outDecimals].every(Number.isInteger) && inPrice > 0 && outPrice > 0;
  const inUsdValue = hasPrices ? (Number(inAmount) / 10 ** inDecimals) * inPrice : undefined;
  const outUsdValue = hasPrices ? (Number(outAmount) / 10 ** outDecimals) * outPrice : undefined;

  return {
    provider,
    quoteId: typeof record.id === "string" ? record.id : "",
    inAmount,
    outAmount,
    slippageBps,
    minOutAmount: (outAmount * BigInt(10_000 - slippageBps)) / 10_000n,
    priceImpactPct: inUsdValue && outUsdValue !== undefined ? ((inUsdValue - outUsdValue) / inUsdValue) * 100 : null,
    inUsdValue,
    outUsdValue,
    instructions: instructions as TitanInstruction[],
    lookupTables,
    computeUnitsSafe: Number(route.computeUnitsSafe) || Number(route.computeUnits) || 0,
    expiresAtMs: typeof route.expiresAtMs === "number" ? route.expiresAtMs : undefined,
  };
}

/** Readable message for a Titan Portal error response. */
export function titanErrorMessage(status: number, body: unknown) {
  const error = ((body ?? {}) as { error?: { code?: unknown; message?: unknown } | string; code?: unknown }).error;
  const code = typeof error === "object" && error ? error.code : (body as { code?: unknown } | null)?.code;
  if (status === 404 || code === -7) return "Titan found no route for this swap.";
  if (code === "rate_limited" || code === "allowance_exhausted" || status === 429) return "Titan is rate limiting quotes right now.";
  if (code === "invalid_api_key" || status === 401) return "Titan rejected the server's API key.";
  return typeof error === "object" && error && typeof error.message === "string" ? error.message : `Titan quote failed (${status}).`;
}
