import { NextResponse } from "next/server";
import { getAsterMarkets } from "@/lib/venues/aster/markets-server";

/**
 * Aster's perp markets as the terminal's `VenueMarket` list: exchange info, 24h tickers and mark prices (about 100 KB
 * from Aster) fetched here once every 30 seconds for every visitor, instead of by each browser on every page load.
 */
export async function GET() {
  try {
    return NextResponse.json(await getAsterMarkets(), { headers: { "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60" } });
  } catch (error) {
    console.warn(`[aster] markets: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json({ error: "Aster market list is unavailable" }, { status: 502 });
  }
}
