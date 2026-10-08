import { NextResponse, type NextRequest } from "next/server";
import { mergeListings, normalizeSpotSymbol } from "@/lib/spot/listings";
import { getSpotListings, searchJupiterListings, searchUniswapListings } from "@/lib/spot/server";
import { rateLimited } from "@/lib/rate-limit";

const QUERY_PATTERN = /^[\p{L}\p{N} $._-]{1,64}$/u;

/**
 * Spot search by ticker, name or address: the cached pairs plus Jupiter's search and, with Uniswap on, DexScreener's
 * (EVM tokens on Ethereum, Base and Arbitrum). Both also find unverified tokens.
 */
export async function GET(request: NextRequest) {
  const limited = rateLimited(request, "spot-search");
  if (limited) return limited;
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!QUERY_PATTERN.test(query)) return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  const wanted = normalizeSpotSymbol(query);
  const [cached, jupiter, uniswap] = await Promise.all([
    getSpotListings().catch(() => []),
    searchJupiterListings(query).catch(() => []),
    searchUniswapListings(query).catch(() => []),
  ]);
  const local = cached.filter(
    (listing) => normalizeSpotSymbol(listing.symbol).includes(wanted) || listing.name.toUpperCase().includes(wanted) || listing.address.toLowerCase() === query.toLowerCase(),
  );
  return NextResponse.json({ listings: mergeListings(local, jupiter, uniswap).slice(0, 60) }, { headers: { "cache-control": "public, max-age=30, s-maxage=60" } });
}
