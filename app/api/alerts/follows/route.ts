import { NextResponse, type NextRequest } from "next/server";
import { readSettings, saveSettings } from "@/lib/alerts/store";
import { readWatchedWallets } from "@/lib/copy/follows";
import { SESSION_COOKIE, sessionId } from "@/lib/profile/session";
import { sameOrigin } from "@/lib/same-origin";

/**
 * The followed wallets the signed-in profile gets alerts about (the /copy page's Alerts switches). Only this list
 * changes: the rest of the alert settings stay as Profile → Alerts saved them.
 */
export async function PUT(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = await sessionId(request.cookies.get(SESSION_COOKIE)?.value);
  if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { follows?: unknown } | null;
  const follows = readWatchedWallets(body?.follows);
  if (!follows) return NextResponse.json({ error: "Invalid followed wallets." }, { status: 400 });
  const settings = { ...(await readSettings(id)), follows };
  await saveSettings(id, settings);
  return NextResponse.json({ follows, channel: Boolean(settings.discordWebhook || settings.telegramChatId) });
}
