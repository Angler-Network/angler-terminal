import { NextResponse } from "next/server";
import { readOffServices } from "@/lib/ops/kill-switch";

/** Services an admin turned off for everyone (`{ off: ["bridge:relay"] }`); browsers re-read it every minute. */
export async function GET() {
  try {
    return NextResponse.json({ off: await readOffServices() }, { headers: { "cache-control": "public, max-age=15, s-maxage=15" } });
  } catch {
    // If the list can't be read, nothing is reported off (the venues' own errors still stop a broken route).
    return NextResponse.json({ off: [] }, { headers: { "cache-control": "no-store" } });
  }
}
