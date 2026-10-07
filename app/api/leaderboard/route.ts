import { NextResponse } from "next/server";
import { readLeaderboard } from "@/lib/profile/store";

/** The top profiles by points (0.01 per dollar traded through the terminal). */
export async function GET() {
  try {
    return NextResponse.json({ entries: await readLeaderboard() }, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch (error) {
    return NextResponse.json({ error: `Couldn't read the leaderboard: ${error instanceof Error ? error.message : String(error)}` }, { status: 502 });
  }
}
