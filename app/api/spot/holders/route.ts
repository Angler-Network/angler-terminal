import { unstable_cache } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { readLargestHolders, type TokenHolder } from "@/lib/spot/token-activity";
import { isSolanaAddress } from "@/lib/venues/jupiter/config";
import { jupFetch, jupServerConfig } from "@/lib/venues/jupiter/server";

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(jupServerConfig().rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json()) as { result?: T; error?: { message?: string } };
  if (!response.ok || body.error || body.result === undefined) throw new Error(body.error?.message ?? `RPC ${response.status}`);
  return body.result;
}

interface HoldersAnswer {
  /** Jupiter's holder count and top-10 share (percent); null when it has none. */
  count: number | null;
  top10Pct: number | null;
  /** The largest wallets (Solana RPC, up to 20 accounts merged per owner); empty when the RPC refuses (public RPCs rate limit it). */
  holders: TokenHolder[];
}

/** Holder count and top-10 share from Jupiter, cached ten minutes. */
const holderStats = unstable_cache(
  async (mint: string): Promise<Pick<HoldersAnswer, "count" | "top10Pct">> => {
    const response = await jupFetch(`/tokens/v2/search?query=${mint}`);
    const body = (response.ok ? await response.json() : []) as unknown;
    const record = Array.isArray(body) ? (body as Array<Record<string, unknown>>).find((entry) => entry.id === mint) : undefined;
    const audit = (record?.audit ?? {}) as Record<string, unknown>;
    return {
      count: typeof record?.holderCount === "number" ? record.holderCount : null,
      top10Pct: typeof audit.topHoldersPercentage === "number" ? audit.topHoldersPercentage : null,
    };
  },
  ["spot-holder-stats-v1"],
  { revalidate: 600 },
);

/**
 * The largest wallets, cached ten minutes. A refused call throws, so an RPC that rate limits it (public RPCs do)
 * isn't cached as "no holders": the next request tries again.
 */
const largestHolders = unstable_cache(
  async (mint: string): Promise<TokenHolder[]> => {
    const [largest, supply] = await Promise.all([
      rpc<{ value: Array<{ address: string; uiAmount: number | null }> }>("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]),
      rpc<{ value: { uiAmount: number | null } }>("getTokenSupply", [mint, { commitment: "confirmed" }]),
    ]);
    const accounts = await rpc<{ value: Array<{ data?: { parsed?: { info?: { owner?: string } } } } | null> }>("getMultipleAccounts", [
      largest.value.map((entry) => entry.address),
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]);
    const owners = Object.fromEntries(largest.value.map((entry, index) => [entry.address, accounts.value[index]?.data?.parsed?.info?.owner]));
    return readLargestHolders(largest.value, owners, supply.value.uiAmount ?? 0);
  },
  ["spot-largest-holders-v1"],
  { revalidate: 600 },
);

/** Holders of a Solana token (the swap view's Holders tab). Robinhood Chain tokens link to the explorer instead. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!isSolanaAddress(token)) return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  try {
    const [stats, holders] = await Promise.all([
      holderStats(token).catch(() => ({ count: null, top10Pct: null })),
      largestHolders(token).catch((error: unknown) => {
        console.warn("[spot/holders] rpc", error instanceof Error ? error.message : error);
        return [] as TokenHolder[];
      }),
    ]);
    const answer: HoldersAnswer = { ...stats, holders };
    // A short browser cache when the wallets are missing, so a retry comes soon.
    return NextResponse.json(answer, { headers: { "cache-control": holders.length ? "public, max-age=60, s-maxage=300" : "public, max-age=30" } });
  } catch {
    return NextResponse.json({ error: "Holders are unavailable right now." }, { status: 502 });
  }
}
