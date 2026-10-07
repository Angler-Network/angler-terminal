import { NextResponse, type NextRequest } from "next/server";
import { profileIdOf } from "@/lib/profile/identity";
import { syncProfile } from "@/lib/profile/server";
import { ensOf } from "@/lib/profile/ens";
import { readProfile } from "@/lib/profile/store";

/**
 * A wallet's public profile: username, points, level, rank and volume per venue. `?sync=1` first pulls new
 * Hyperliquid and Lighter volume (at most once a minute per profile; the venues' data is public, so anyone may ask).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsed = profileIdOf(decodeURIComponent((await params).id));
  if (!parsed) return NextResponse.json({ error: "Unknown wallet address." }, { status: 400 });
  try {
    if (request.nextUrl.searchParams.get("sync") === "1") await syncProfile(parsed.id);
    const [profile, ens] = await Promise.all([readProfile(parsed.id), ensOf(parsed.id)]);
    return NextResponse.json({ ...profile, ens }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: `Couldn't read the profile: ${error instanceof Error ? error.message : String(error)}` }, { status: 502 });
  }
}
