import { NextResponse, type NextRequest } from "next/server";
import { sendTelegram, telegramConfig } from "@/lib/alerts/channels";
import { createTelegramLink, unlinkTelegram } from "@/lib/alerts/store";
import { SESSION_COOKIE, sessionId } from "@/lib/profile/session";
import { sameOrigin } from "@/lib/same-origin";

/** A t.me link that opens the bot with a one-time code; pressing Start there links the chat to this profile. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const config = telegramConfig();
  if (!config) return NextResponse.json({ error: "Telegram alerts aren't set up on this site yet." }, { status: 503 });
  const id = await sessionId(request.cookies.get(SESSION_COOKIE)?.value);
  if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const code = await createTelegramLink(id);
  return NextResponse.json({ url: `https://t.me/${config.username}?start=${code}` });
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = await sessionId(request.cookies.get(SESSION_COOKIE)?.value);
  if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const chat = await unlinkTelegram(id);
  if (chat) await sendTelegram(chat, ["Angler alerts are off for this chat. Connect again from your profile any time."]);
  return NextResponse.json({ ok: true });
}
