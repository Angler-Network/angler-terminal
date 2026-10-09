import { NextResponse, type NextRequest } from "next/server";
import { rateLimited } from "@/lib/rate-limit";
import { getVaults } from "@/lib/vaults/server";

// Hyperliquid's vault list takes 10-15s to download when the cache is cold.
export const maxDuration = 60;

/** Open vaults of every perp venue (Hyperliquid, Lighter, Lighter RH, Orderly), cached 15 minutes. */
export async function GET(request: NextRequest) {
  const limited = rateLimited(request, "vaults");
  if (limited) return limited;
  const result = await getVaults();
  return NextResponse.json(result, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
