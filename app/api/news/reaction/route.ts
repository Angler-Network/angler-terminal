import { NextResponse, type NextRequest } from "next/server";
import { anglerConfig, missingKeyResponse } from "@/lib/angler/env";
import { reactionBucket } from "@/lib/news/reaction";
import { getNewsReaction } from "@/lib/news/reaction-server";

const SYMBOL_PATTERN = /^[A-Z0-9]{1,20}$/;

/**
 * GET /api/news/reaction?coin=BTC&min=60: how the asset moved 1h / 4h / 24h after its past news at that impact,
 * from Hyperliquid mainnet candles (last ~50 days). Cached 15 minutes.
 */
export async function GET(request: NextRequest) {
  if (!anglerConfig().key) return NextResponse.json(missingKeyResponse, { status: 503 });
  const symbol = request.nextUrl.searchParams.get("coin")?.toUpperCase() ?? "";
  if (!SYMBOL_PATTERN.test(symbol)) return NextResponse.json({ error: "Invalid coin" }, { status: 400 });
  const minImpact = reactionBucket(Number(request.nextUrl.searchParams.get("min")) || 0);
  try {
    const reaction = await getNewsReaction(symbol, minImpact);
    return NextResponse.json(reaction, { headers: { "cache-control": "public, max-age=300, s-maxage=900, stale-while-revalidate=900" } });
  } catch {
    return NextResponse.json({ error: "Reaction data unavailable" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
