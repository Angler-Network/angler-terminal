import { NextResponse } from "next/server";
import { getConfiguredHlMarkets } from "@/lib/venues/hyperliquid/markets-server";

export async function GET() {
  try {
    return NextResponse.json(await getConfiguredHlMarkets(), {
      headers: { "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch {
    return NextResponse.json({ error: "Hyperliquid market list is unavailable" }, { status: 502 });
  }
}
