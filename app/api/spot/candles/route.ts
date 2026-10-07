import { NextResponse, type NextRequest } from "next/server";
import { isChartInterval } from "@/lib/chart/candles";
import { isPoolNetwork, isTokenAddress, MAX_POOL_CANDLES } from "@/lib/spot/pool-candles";
import { getPoolCandles } from "@/lib/spot/pool-candles-server";

/**
 * A spot token's own candles (its busiest DEX pool): ?network=solana|robinhood&address=&interval=&count=.
 * 404 when no indexed pool trades the token, 502 when the data source is down or rate limited; the chart then
 * falls back to the asset's market chart.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const network = params.get("network");
  const address = params.get("address") ?? "";
  const interval = params.get("interval");
  const count = Math.round(Number(params.get("count") ?? MAX_POOL_CANDLES));
  if (!isPoolNetwork(network) || !isTokenAddress(network, address) || !isChartInterval(interval) || !(count >= 1 && count <= MAX_POOL_CANDLES)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const result = await getPoolCandles(network, address, interval, count);
    if (!result || result.candles.length === 0) return NextResponse.json({ error: "No pool trades this token" }, { status: 404 });
    return NextResponse.json(result, { headers: { "cache-control": "public, max-age=15, s-maxage=30" } });
  } catch (error) {
    console.error("[spot] pool candles failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Token chart data is unavailable right now." }, { status: 502 });
  }
}
