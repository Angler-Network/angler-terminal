import { unstable_cache } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { isSolanaAddress } from "@/lib/venues/jupiter/config";
import { jupFetch } from "@/lib/venues/jupiter/server";
import { fromJupRecord, pickSpotListing } from "@/lib/spot/listings";
import { pickVerifiedToken, toSpotToken, type JupTokenRecord } from "@/lib/venues/jupiter/tokens";

const SYMBOL_PATTERN = /^[A-Za-z0-9$._-]{1,20}$/;

const search = unstable_cache(
  async (query: string): Promise<JupTokenRecord[]> => {
    const response = await jupFetch(`/tokens/v2/search?query=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error(`Jupiter tokens responded ${response.status}`);
    const body = (await response.json()) as unknown;
    return Array.isArray(body) ? (body as JupTokenRecord[]) : [];
  },
  ["jup-token-search-v1"],
  { revalidate: 300 },
);

/**
 * Resolves ?mint= or ?symbol= to one verified Jupiter token (Tokens V2 search). An asset Jupiter doesn't list is a
 * normal answer (`{ token: null }`, 200): a 404 would log a console error on every page that checks a perp-only asset.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mint = params.get("mint");
  const symbol = params.get("symbol");
  if (mint && !isSolanaAddress(mint)) return NextResponse.json({ error: "Invalid mint" }, { status: 400 });
  if (!mint && !(symbol && SYMBOL_PATTERN.test(symbol))) return NextResponse.json({ error: "Pass a symbol or mint" }, { status: 400 });

  try {
    const records = await search(mint ?? symbol!.replace(/^\$/, ""));
    let token = pickVerifiedToken(records, mint ? { mint } : { symbol: symbol!.replace(/^\$/, "") });
    if (!token && !mint) {
      // No verified token carries the ticker itself (BTC on Solana): trade the most liquid verified token that stands
      // for the asset right now (WBTC, cbBTC, …), decided from Jupiter's live liquidity rather than a fixed alias.
      const listing = pickSpotListing(records.flatMap((record) => fromJupRecord(record) ?? []), symbol!, "jupiter");
      const record = listing ? records.find((entry) => entry.id === listing.address) : undefined;
      token = record ? toSpotToken(record) : null;
    }
    return NextResponse.json(
      { token },
      { headers: { "cache-control": "public, max-age=60, s-maxage=300" } },
    );
  } catch {
    return NextResponse.json({ error: "Jupiter token search is unavailable." }, { status: 502 });
  }
}
