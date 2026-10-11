import { NextResponse } from "next/server";
import { getQfexMarkets } from "@/lib/venues/qfex/markets-server";

/** QFEX's trimmed reference data and contract stats (`markets-server.ts`), cached 30s; public data. */
export async function GET() {
  try {
    return NextResponse.json(await getQfexMarkets(), { headers: { "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60" } });
  } catch (error) {
    console.warn(`[qfex] markets: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json({ error: "QFEX market list is unavailable" }, { status: 502 });
  }
}
