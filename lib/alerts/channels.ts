import "server-only";
import { isDiscordWebhook, type AlertSettings } from "./settings";

/**
 * Sends alert messages to a profile's channels: its Discord webhook and/or the Telegram chat linked to the bot
 * (`TELEGRAM_BOT_TOKEN`). Several messages from one tick go out as one post.
 */

const TIMEOUT_MS = 8_000;
// Discord caps a message at 2,000 characters, Telegram at 4,096.
const DISCORD_LIMIT = 1_900;
const TELEGRAM_LIMIT = 4_000;

/**
 * The bot's username from however it was entered: "angleralertsbot", "@angleralertsbot" or a t.me link. A full link in
 * the setting once made the bot link "t.me/https://t.me/…", so Connect Telegram opened nothing.
 */
export function readBotUsername(value: string | undefined) {
  const name = (value ?? "")
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  return /^\w{5,32}$/.test(name) ? name : null;
}

export function telegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const username = readBotUsername(process.env.TELEGRAM_BOT_USERNAME);
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  return token && username ? { token, username, secret: secret || null } : null;
}

/** Splits messages into posts under a size limit, never inside a message (a longer one is cut). */
export function batchMessages(messages: string[], limit: number) {
  const posts: string[] = [];
  let current = "";
  for (const message of messages) {
    const text = message.length > limit ? `${message.slice(0, limit - 1)}…` : message;
    if (current && current.length + 2 + text.length > limit) {
      posts.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${text}` : text;
  }
  if (current) posts.push(current);
  return posts;
}

export async function sendDiscord(webhook: string, messages: string[]) {
  if (!isDiscordWebhook(webhook)) return false;
  let ok = true;
  for (const content of batchMessages(messages, DISCORD_LIMIT)) {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // No pings: a headline can't @everyone the user's server.
      body: JSON.stringify({ content, username: "Angler", allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null);
    // Logged (never the token) so a wrong bot token or a blocked bot shows in the server logs.
    if (!response?.ok) console.error("[alerts] telegram send failed:", response?.status ?? "network", await response?.text().catch(() => ""));
    ok &&= Boolean(response?.ok);
  }
  return ok;
}

export async function sendTelegram(chatId: string, messages: string[]) {
  const config = telegramConfig();
  if (!config) return false;
  let ok = true;
  for (const text of batchMessages(messages, TELEGRAM_LIMIT)) {
    const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null);
    // Logged (never the token) so a wrong bot token or a blocked bot shows in the server logs.
    if (!response?.ok) console.error("[alerts] telegram send failed:", response?.status ?? "network", await response?.text().catch(() => ""));
    ok &&= Boolean(response?.ok);
  }
  return ok;
}

/** Sends to every channel the profile has; answers which ones took the messages. */
export async function deliver(settings: AlertSettings, messages: string[]) {
  if (messages.length === 0) return { discord: false, telegram: false };
  const [discord, telegram] = await Promise.all([
    settings.discordWebhook ? sendDiscord(settings.discordWebhook, messages) : Promise.resolve(false),
    settings.telegramChatId ? sendTelegram(settings.telegramChatId, messages) : Promise.resolve(false),
  ]);
  return { discord, telegram };
}
