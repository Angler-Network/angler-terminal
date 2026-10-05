import { NextResponse, type NextRequest } from "next/server";
import { defaultHlNetwork, readNetwork } from "@/lib/venues/hyperliquid/config";
import { getConfiguredHlMarkets } from "@/lib/venues/hyperliquid/markets-server";

/** ?network=testnet|mainnet follows the browser's choice in Settings; defaults to NEXT_PUBLIC_HL_NETWORK. */
export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("network");
  const network = requested ? readNetwork(requested) : defaultHlNetwork;
  try {
    return NextResponse.json(await getConfiguredHlMarkets(network), {
      headers: { "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch {
    return NextResponse.json({ error: "Hyperliquid market list is unavailable" }, { status: 502 });
  }
}
