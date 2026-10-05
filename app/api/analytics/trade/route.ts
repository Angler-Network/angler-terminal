import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { readCounters, recordTrade } from "@/lib/analytics/store";
import { readTradeEvent } from "@/lib/analytics/trades";

/** Records a placed trade (venue, side, source news id). Accepts sendBeacon's text/plain bodies. */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const event = readTradeEvent(body);
  if (!event) return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  recordTrade(event);
  return new NextResponse(null, { status: 204 });
}

function isAuthorized(request: NextRequest) {
  const token = process.env.ANALYTICS_TOKEN;
  const header = request.headers.get("authorization");
  if (!token || !header?.startsWith("Bearer ")) return false;
  const expected = Buffer.from(token);
  const received = Buffer.from(header.slice("Bearer ".length));
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Counters for this instance. Requires `Authorization: Bearer <ANALYTICS_TOKEN>`. */
export function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(readCounters(), { headers: { "cache-control": "no-store" } });
}
