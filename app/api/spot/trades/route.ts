import { NextResponse, type NextRequest } from "next/server";
import { isPoolNetwork, isTokenAddress } from "@/lib/spot/pool-candles";
import { getPoolTrades } from "@/lib/spot/pool-candles-server";
import { rateLimited } from "@/lib/rate-limit";

/** Recent swaps of a token in its busiest pool (the swap view's Swaps and Your trades tabs). */
export async function GET(request: NextRequest) {
  const limited = rateLimited(request, "spot-trades");
  if (limited) return limited;
  const network = request.nextUrl.searchParams.get("network");
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!isPoolNetwork(network) || !isTokenAddress(network, token)) return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  try {
    const result = await getPoolTrades(network, token);
    return NextResponse.json(result ?? { pool: null, trades: [] }, { headers: { "cache-control": "public, max-age=20, s-maxage=30" } });
  } catch (error) {
    console.warn("[spot/trades]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Recent swaps are unavailable right now." }, { status: 502 });
  }
}
