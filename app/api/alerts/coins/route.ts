import { unstable_cache } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { alertCoins } from "@/lib/alerts/sources";
import { rateLimited } from "@/lib/rate-limit";

const coins = unstable_cache(alertCoins, ["alert-coins-v2"], { revalidate: 60 });

/** The coins price alerts can watch (Hyperliquid, then what only Lighter, Lighter RH or Aster lists; the same prices the alerts tick reads), with their price now. */
export async function GET(request: NextRequest) {
  const limited = rateLimited(request, "alert-coins");
  if (limited) return limited;
  try {
    return NextResponse.json({ coins: await coins() }, { headers: { "cache-control": "public, s-maxage=60" } });
  } catch {
    return NextResponse.json({ coins: [] }, { status: 502 });
  }
}
