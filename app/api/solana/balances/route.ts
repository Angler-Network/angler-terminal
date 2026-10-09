import { NextResponse, type NextRequest } from "next/server";
import { sumTokenAccounts } from "@/lib/venues/jupiter/balances";
import { isSolanaAddress } from "@/lib/venues/jupiter/config";
import { jupServerConfig } from "@/lib/venues/jupiter/server";
import { rateLimited } from "@/lib/rate-limit";

const MAX_MINTS = 4;
// The same wallet open in several tabs asks for the same balances: one RPC read per few seconds per instance serves them.
const FRESH_MS = 4_000;
const MAX_ENTRIES = 2_000;
const reads = new Map<string, { at: number; body: Promise<{ lamports: string; tokens: Record<string, string> }> }>();

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
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

/**
 * SOL and SPL balances for a wallet via Solana RPC (the RPC URL, which may embed a provider key, stays server-side).
 * Amounts are raw base-unit strings.
 */
export async function GET(request: NextRequest) {
  const limited = rateLimited(request, "solana-balances");
  if (limited) return limited;
  const params = request.nextUrl.searchParams;
  const owner = params.get("owner");
  const mints = [...new Set((params.get("mints") ?? "").split(",").filter(Boolean))].slice(0, MAX_MINTS);
  if (!isSolanaAddress(owner) || !mints.every(isSolanaAddress)) return NextResponse.json({ error: "Invalid owner or mints" }, { status: 400 });

  const { rpcUrl } = jupServerConfig();
  const key = `${owner}|${[...mints].sort().join(",")}`;
  const hit = reads.get(key);
  const load = async () => {
    const [balance, ...accounts] = await Promise.all([
      rpc<{ value: number }>(rpcUrl, "getBalance", [owner, { commitment: "confirmed" }]),
      ...mints.map((mint) =>
        rpc<{ value: Parameters<typeof sumTokenAccounts>[0] }>(rpcUrl, "getTokenAccountsByOwner", [
          owner,
          { mint },
          { encoding: "jsonParsed", commitment: "confirmed" },
        ]),
      ),
    ]);
    const tokens = Object.fromEntries(mints.map((mint, index) => [mint, sumTokenAccounts(accounts[index].value).toString()]));
    return { lamports: String(balance.value), tokens };
  };
  // `fresh`: right before or after a trade, never a copy.
  let body = hit && Date.now() - hit.at < FRESH_MS && params.get("fresh") !== "1" ? hit.body : null;
  if (!body) {
    body = load();
    reads.set(key, { at: Date.now(), body });
    body.catch(() => reads.delete(key));
    if (reads.size > MAX_ENTRIES) reads.delete(reads.keys().next().value!);
  }
  try {
    return NextResponse.json(await body, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't read balances from Solana RPC." }, { status: 502 });
  }
}
