import { NextResponse } from "next/server";
import { readClosedBeta } from "@/lib/ops/beta";
import { readOffServices } from "@/lib/ops/kill-switch";

/**
 * What admins switched for everyone: services turned off (`{ off: ["bridge:relay"] }`) and whether the closed beta is
 * on (`closedBeta`); browsers re-read it every minute.
 */
export async function GET() {
  try {
    const [off, closedBeta] = await Promise.all([readOffServices(), readClosedBeta()]);
    return NextResponse.json({ off, closedBeta }, { headers: { "cache-control": "public, max-age=15, s-maxage=15" } });
  } catch {
    // If the list can't be read, nothing is reported off (the venues' own errors still stop a broken route); the gate
    // keeps whatever the page was rendered with.
    return NextResponse.json({ off: [] }, { headers: { "cache-control": "no-store" } });
  }
}
