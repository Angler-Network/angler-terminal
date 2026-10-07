import { NextResponse, type NextRequest } from "next/server";
import { defaultLighterNetwork, defaultLighterRhNetwork, readLighterNetwork } from "@/lib/venues/lighter/config";
import { getLighterMarkets } from "@/lib/venues/lighter/markets-server";

/**
 * ?network=testnet|mainnet follows the browser's choice in Settings; defaults to NEXT_PUBLIC_LIGHTER_NETWORK.
 * ?instance=rh lists Lighter on Robinhood Chain instead (default network NEXT_PUBLIC_LIGHTER_RH_NETWORK).
 */
export async function GET(request: NextRequest) {
  const instance = request.nextUrl.searchParams.get("instance") === "rh" ? "rh" : "core";
  const requested = request.nextUrl.searchParams.get("network");
  const network = requested ? readLighterNetwork(requested) : instance === "rh" ? defaultLighterRhNetwork : defaultLighterNetwork;
  try {
    return NextResponse.json(await getLighterMarkets(network, instance), {
      headers: { "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch {
    return NextResponse.json({ error: "Lighter market list is unavailable" }, { status: 502 });
  }
}
