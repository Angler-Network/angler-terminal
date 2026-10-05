import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_TAPE_MARKET, isMarketType, pickMarkets, readTapeSymbols } from "@/lib/markets/model";
import { getMarkets } from "@/lib/markets/server";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const market = params.get("market");
  const markets = await getMarkets(isMarketType(market) ? market : DEFAULT_TAPE_MARKET);
  const requested = params.get("symbols");
  const body = requested === null ? markets : pickMarkets(markets, readTapeSymbols(requested.split(",")) ?? []);

  return NextResponse.json(body, {
    headers: { "cache-control": "public, max-age=10, s-maxage=20, stale-while-revalidate=40" },
  });
}
