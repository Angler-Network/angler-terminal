import { NextResponse, type NextRequest } from "next/server";
import { getRecentTrades } from "@/lib/prediction/server";
import { DEFAULT_MIN_TRADE_USD } from "@/lib/prediction/trades";

/** Allowed minimum sizes, so the cache keys stay few. */
const MINIMUMS = [1, 10, 100, 1000];

/** GET /api/prediction/trades?min=1|10|100|1000 : Polymarket's latest taker trades of at least that many dollars. */
export async function GET(request: NextRequest) {
  const asked = Number(request.nextUrl.searchParams.get("min"));
  const min = MINIMUMS.includes(asked) ? asked : DEFAULT_MIN_TRADE_USD;
  try {
    return NextResponse.json({ trades: await getRecentTrades(min) }, { headers: { "cache-control": "public, s-maxage=3, stale-while-revalidate=10" } });
  } catch (error) {
    console.warn(`[prediction] trades failed: ${String(error)}`);
    return NextResponse.json({ error: "Polymarket's trades feed is unreachable right now." }, { status: 502 });
  }
}
