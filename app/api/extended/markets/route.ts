import { NextResponse, type NextRequest } from "next/server";
import { readExtendedNetwork } from "@/lib/venues/extended/config";
import { getExtendedMarkets } from "@/lib/venues/extended/markets-server";

/** Extended's trimmed market list (`markets-server.ts`), cached 30s; public data, so no country check. */
export const preferredRegion = "hnd1";

export async function GET(request: NextRequest) {
  const network = readExtendedNetwork(request.nextUrl.searchParams.get("network") ?? undefined);
  try {
    return NextResponse.json({ markets: await getExtendedMarkets(network) }, { headers: { "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60" } });
  } catch (error) {
    console.warn(`[extended] markets: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json({ error: "Extended market list is unavailable" }, { status: 502 });
  }
}
