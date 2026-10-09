import { NextResponse, type NextRequest } from "next/server";
import { listingPart } from "@/lib/spot/listings";
import { getSpotListings } from "@/lib/spot/server";

/**
 * Every spot pair from the integrated venues' pools, cached two minutes on the server. `?part=core` (Jupiter, Arcus,
 * order-book spot) is what a first screen loads; `?part=evm` (the EVM tokens) follows it; no `part` is everything.
 */
export async function GET(request: NextRequest) {
  const part = request.nextUrl.searchParams.get("part");
  try {
    const all = await getSpotListings();
    const listings = part === "core" || part === "evm" ? all.filter((listing) => listingPart(listing) === part) : all;
    return NextResponse.json({ listings }, { headers: { "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json({ error: "Spot markets are unavailable right now.", listings: [] }, { status: 502 });
  }
}
