import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runAlertsTick } from "@/lib/alerts/tick";

export const maxDuration = 60;

/**
 * Runs the alerts once. Called every minute by a scheduler with `Authorization: Bearer <CRON_SECRET>` (Vercel Cron
 * sends that header itself; cron-job.org can be set to). Without CRON_SECRET the route is off.
 */
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await runAlertsTick(), { headers: { "cache-control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
