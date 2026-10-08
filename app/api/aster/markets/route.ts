import { NextResponse } from "next/server";
import { ASTER_API_URL } from "@/lib/venues/aster/config";
import { readAsterMarkets } from "@/lib/venues/aster/markets";

/**
 * Aster's perp markets as the terminal's `VenueMarket` list: exchange info, 24h tickers and mark prices (about 100 KB
 * from Aster) fetched here once every 30 seconds for every visitor, instead of by each browser on every page load.
 */
async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${ASTER_API_URL}${path}`, { next: { revalidate: 30 }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Aster answered ${response.status}`);
  return (await response.json()) as T;
}

export async function GET() {
  try {
    const [info, tickers, premium] = await Promise.all([
      get<{ symbols?: unknown[] }>("/fapi/v1/exchangeInfo"),
      get<unknown[]>("/fapi/v1/ticker/24hr"),
      get<unknown[]>("/fapi/v1/premiumIndex"),
    ]);
    const markets = readAsterMarkets(
      (info.symbols ?? []) as Parameters<typeof readAsterMarkets>[0],
      (Array.isArray(tickers) ? tickers : []) as Parameters<typeof readAsterMarkets>[1],
      (Array.isArray(premium) ? premium : []) as Parameters<typeof readAsterMarkets>[2],
    );
    if (markets.length === 0) throw new Error("Aster listed no markets");
    return NextResponse.json(markets, { headers: { "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60" } });
  } catch (error) {
    console.warn(`[aster] markets: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json({ error: "Aster market list is unavailable" }, { status: 502 });
  }
}
