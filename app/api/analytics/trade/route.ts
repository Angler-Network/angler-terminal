import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { allowEvent, analyticsBackend, readStats, readTopNews, recordTrade } from "@/lib/analytics/store";
import { readTradeEvent, sumTotals } from "@/lib/analytics/trades";

/** Only this site's pages may post (browsers always send Origin on POST); other sites can't inflate the totals. */
function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

/** Records a trade (venue, side, USD volume, source news id) into daily totals. Accepts sendBeacon's text bodies. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const event = readTradeEvent(body);
  if (!event) return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await allowEvent(ip))) return NextResponse.json({ error: "Too many events" }, { status: 429 });
  await recordTrade(event);
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

/**
 * Private totals: all-time, today, 7- and 30-day sums, the last `days` (default 30, max 90) per UTC day with
 * estimated fees, and the news items that drove the most volume this week. Requires
 * `Authorization: Bearer <ANALYTICS_TOKEN>`.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get("days")) || 30));
  try {
    // At least 30 days are read so the 30-day sum is complete whatever `days` asks for.
    const [stats, topNews] = await Promise.all([readStats(Math.max(days, 30)), readTopNews()]);
    const summary = {
      today: stats.days[stats.days.length - 1],
      last7Days: sumTotals(stats.days.slice(-7)),
      last30Days: sumTotals(stats.days.slice(-30)),
      allTime: stats.total,
    };
    return NextResponse.json({ backend: stats.backend, summary, days: stats.days.slice(-days), topNews }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Couldn't read ${analyticsBackend()} stats: ${message}` }, { status: 502 });
  }
}
