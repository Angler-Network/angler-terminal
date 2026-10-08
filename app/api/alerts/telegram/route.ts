import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { sendTelegram, telegramConfig } from "@/lib/alerts/channels";
import { claimTelegramLink, unlinkChat } from "@/lib/alerts/store";
import { shortAddress } from "@/lib/profile/identity";

/**
 * Telegram bot webhook (set once with setWebhook and `secret_token` = TELEGRAM_WEBHOOK_SECRET). `/start <code>`
 * links the chat to the profile that made the code; `/stop` unlinks it. Always answers 200 so Telegram doesn't retry.
 */
export async function POST(request: NextRequest) {
  const config = telegramConfig();
  if (!config?.secret) return NextResponse.json({ ok: false }, { status: 503 });
  const given = Buffer.from(request.headers.get("x-telegram-bot-api-secret-token") ?? "");
  const expected = Buffer.from(config.secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ ok: false }, { status: 401 });

  const update = (await request.json().catch(() => null)) as { message?: { text?: unknown; chat?: { id?: unknown; type?: unknown } } } | null;
  const text = typeof update?.message?.text === "string" ? update.message.text.trim() : "";
  const chatId = update?.message?.chat?.id;
  if (typeof chatId !== "number" && typeof chatId !== "string") return NextResponse.json({ ok: true });
  const chat = String(chatId);

  const start = /^\/start(?:@\w+)?\s+([\w-]{6,40})$/.exec(text);
  if (start) {
    const id = await claimTelegramLink(start[1], chat);
    await sendTelegram(chat, [
      id
        ? `✅ Connected to ${shortAddress(id)}. Choose what to hear about in your Angler profile → Alerts. Send /stop to turn alerts off.`
        : "That link has expired. Open Profile → Alerts on Angler and press Connect Telegram again.",
    ]);
  } else if (/^\/stop(?:@\w+)?$/.test(text)) {
    await sendTelegram(chat, [(await unlinkChat(chat)) ? "Alerts are off for this chat." : "This chat isn't linked to an Angler profile."]);
  } else if (/^\/start(?:@\w+)?$/.test(text)) {
    await sendTelegram(chat, ["Open Profile → Alerts on Angler and press Connect Telegram to link this chat."]);
  }
  return NextResponse.json({ ok: true });
}
