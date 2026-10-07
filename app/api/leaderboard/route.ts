import { NextResponse } from "next/server";
import { ensOf } from "@/lib/profile/ens";
import { readLeaderboard } from "@/lib/profile/store";

/** The top profiles by points (0.01 per dollar traded through the terminal). */
export async function GET() {
  try {
    // ENS names are cached for hours, so this is one RPC round per new wallet, not per request.
    const entries = await readLeaderboard();
    const named = await Promise.all(entries.map(async (entry) => ({ ...entry, ens: await ensOf(entry.id) })));
    return NextResponse.json({ entries: named }, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch (error) {
    return NextResponse.json({ error: `Couldn't read the leaderboard: ${error instanceof Error ? error.message : String(error)}` }, { status: 502 });
  }
}
