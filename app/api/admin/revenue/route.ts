import { NextResponse, type NextRequest } from "next/server";
import { FIRST_REVENUE_YEAR, revenueReport, yearDates } from "@/lib/analytics/revenue";
import { readDates, readStats } from "@/lib/analytics/store";
import { dayKey } from "@/lib/analytics/trades";
import { isAdmin } from "@/lib/profile/admin";
import { SESSION_COOKIE, sessionId } from "@/lib/profile/session";

/** Platform revenue for signed-in admins: all time, last 30 and 7 days, and `?year=` month by month. */
export async function GET(request: NextRequest) {
  const id = await sessionId(request.cookies.get(SESSION_COOKIE)?.value);
  if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isAdmin(id)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const now = new Date();
  const today = dayKey(now);
  const thisYear = now.getUTCFullYear();
  const asked = Number(request.nextUrl.searchParams.get("year"));
  const year = Number.isInteger(asked) && asked >= FIRST_REVENUE_YEAR && asked <= thisYear ? asked : thisYear;
  const [recent, chosen] = await Promise.all([readStats(30, now), readDates(yearDates(year, today))]);
  const report = revenueReport(year, recent.total, recent.days, chosen.days);
  return NextResponse.json({ ...report, years: Array.from({ length: thisYear - FIRST_REVENUE_YEAR + 1 }, (_, index) => FIRST_REVENUE_YEAR + index) }, { headers: { "cache-control": "no-store" } });
}
