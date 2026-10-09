import { NextResponse } from "next/server";
import { getSpotListings } from "@/lib/spot/server";

/** Every spot pair from the integrated venues' pools (Jupiter, Arcus), cached two minutes on the server. */
export async function GET() {
  try {
    const listings = await getSpotListings();
    return NextResponse.json({ listings }, { headers: { "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json({ error: "Spot markets are unavailable right now.", listings: [] }, { status: 502 });
  }
}
