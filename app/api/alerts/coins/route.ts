import { unstable_cache } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { readAlertCoins } from "@/lib/alerts/coins";
import { hlMids } from "@/lib/alerts/sources";
import { rateLimited } from "@/lib/rate-limit";

const coins = unstable_cache(
  async () => {
    const list = readAlertCoins(await hlMids());
    if (list.length === 0) throw new Error("Hyperliquid sent no prices."); // never cache an empty list
    return list;
  },
  ["alert-coins-v1"],
  { revalidate: 60 },
);

/** The coins price alerts can watch (the same Hyperliquid mids the alerts tick reads), with their price now. */
export async function GET(request: NextRequest) {
  const limited = rateLimited(request, "alert-coins");
  if (limited) return limited;
  try {
    return NextResponse.json({ coins: await coins() }, { headers: { "cache-control": "public, s-maxage=60" } });
  } catch {
    return NextResponse.json({ coins: [] }, { status: 502 });
  }
}
