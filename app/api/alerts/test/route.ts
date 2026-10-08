import { NextResponse, type NextRequest } from "next/server";
import { deliver } from "@/lib/alerts/channels";
import { hasChannel } from "@/lib/alerts/settings";
import { readSettings } from "@/lib/alerts/store";
import { allowEvent } from "@/lib/analytics/store";
import { SESSION_COOKIE, sessionId } from "@/lib/profile/session";
import { clientIp, sameOrigin } from "@/lib/same-origin";

/** Sends a test message to the signed-in profile's saved channels. Answers which ones took it. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await allowEvent(clientIp(request)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const id = await sessionId(request.cookies.get(SESSION_COOKIE)?.value);
  if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const settings = await readSettings(id);
  if (!hasChannel(settings)) return NextResponse.json({ error: "Save a Discord webhook or connect Telegram first." }, { status: 400 });
  return NextResponse.json(await deliver(settings, ["✅ Angler alerts are connected. Position, price and news alerts will arrive here."]));
}
