import { NextResponse, type NextRequest } from "next/server";
import { isSolanaAddress } from "@/lib/venues/jupiter/config";
import { buildHoldings, rawAmountsByMint, type ParsedTokenAccount } from "@/lib/venues/jupiter/holdings";
import { jupFetch, jupServerConfig } from "@/lib/venues/jupiter/server";
import type { JupTokenRecord } from "@/lib/venues/jupiter/tokens";
import { rateLimited } from "@/lib/rate-limit";

const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
/** Jupiter's token search takes up to 100 comma-separated mints. */
const SEARCH_BATCH = 100;
/** Wallets full of airdrops: value the first ones rather than hammering Jupiter. */
const MAX_MINTS = 300;

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

async function tokenRecords(mints: string[]) {
  const batches = Array.from({ length: Math.ceil(mints.length / SEARCH_BATCH) }, (_, index) => mints.slice(index * SEARCH_BATCH, (index + 1) * SEARCH_BATCH));
  const results = await Promise.all(
    batches.map(async (batch) => {
      const response = await jupFetch(`/tokens/v2/search?query=${batch.join(",")}`);
      if (!response.ok) throw new Error(`Jupiter tokens responded ${response.status}`);
      const body = (await response.json()) as unknown;
      return Array.isArray(body) ? (body as JupTokenRecord[]) : [];
    }),
  );
  return results.flat();
}

/**
 * Every token in a Solana wallet (SOL included) with Jupiter's symbol, icon and USD price, for the portfolio's spot
 * view. The RPC URL and Jupiter key stay server-side.
 */
export async function GET(request: NextRequest) {
  const limited = rateLimited(request, "solana-holdings");
  if (limited) return limited;
  const owner = request.nextUrl.searchParams.get("owner");
  if (!isSolanaAddress(owner)) return NextResponse.json({ error: "Invalid owner" }, { status: 400 });
  const { rpcUrl } = jupServerConfig();
  try {
    const [balance, ...programs] = await Promise.all([
      rpc<{ value: number }>(rpcUrl, "getBalance", [owner, { commitment: "confirmed" }]),
      ...TOKEN_PROGRAMS.map((programId) =>
        rpc<{ value: ParsedTokenAccount[] }>(rpcUrl, "getTokenAccountsByOwner", [owner, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }]),
      ),
    ]);
    const amounts = rawAmountsByMint(programs.flatMap((program) => program.value));
    const mints = [...new Set(["So11111111111111111111111111111111111111112", ...amounts.keys()])].slice(0, MAX_MINTS);
    const records = await tokenRecords(mints).catch(() => []);
    return NextResponse.json(buildHoldings(amounts, BigInt(balance.value), records), { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't read the wallet from Solana RPC." }, { status: 502 });
  }
}
