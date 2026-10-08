import { NextResponse, type NextRequest } from "next/server";
import { telegramConfig } from "@/lib/alerts/channels";
import { readAlertSettings } from "@/lib/alerts/settings";
import { readFiredPrices, readSettings, saveSettings } from "@/lib/alerts/store";
import { SESSION_COOKIE, sessionId } from "@/lib/profile/session";
import { sameOrigin } from "@/lib/same-origin";

/** The signed-in profile's alert settings (Profile → Alerts). The webhook URL is private, so only its owner reads it. */
export async function GET(request: NextRequest) {
  const id = await sessionId(request.cookies.get(SESSION_COOKIE)?.value);
  if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const [settings, fired] = await Promise.all([readSettings(id), readFiredPrices(id)]);
  return NextResponse.json(
    { settings, fired, telegram: Boolean(telegramConfig()), evm: /^0x[0-9a-f]{40}$/.test(id) },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function PUT(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = await sessionId(request.cookies.get(SESSION_COOKIE)?.value);
  if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const result = readAlertSettings(body, await readSettings(id));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  await saveSettings(id, result.settings);
  return NextResponse.json({ settings: result.settings });
}
