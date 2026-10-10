import "server-only";
import { randomBytes } from "node:crypto";
import { redisConfig, redisPipeline, toHash } from "@/lib/redis";
import type { LeaderPosition } from "@/lib/copy/events";
import { EMPTY_STATE, type AlertState } from "./rules";
import { parseStoredSettings, type AlertSettings } from "./settings";

/**
 * Alert settings and tick state in Redis, one hash each with a field per profile, so a tick reads every profile in
 * one command whatever the number of users (memory without Redis, for local dev). Keys are per deployment.
 */
const PREFIX = `angler:alerts:${process.env.NEXT_PUBLIC_DEPLOYMENT || "dev"}`;
const SETTINGS = `${PREFIX}:settings`;
const STATE = `${PREFIX}:state`;
const NEWS_CURSOR = `${PREFIX}:news-cursor`;
const TELEGRAM_CHATS = `${PREFIX}:telegram-chats`;
const LOCK = `${PREFIX}:tick-lock`;
const LEADERS = `${PREFIX}:leaders`;
const LINK_TTL_SECONDS = 15 * 60;

const memory = {
  settings: new Map<string, string>(),
  state: new Map<string, string>(),
  chats: new Map<string, string>(),
  links: new Map<string, string>(),
  leaders: new Map<string, string>(),
  cursor: 0,
};

/** A followed wallet as the tick last saw it, shared by every profile following it. */
export interface LeaderState {
  /** Positions by coin; null until the first look (which only records). */
  positions: Record<string, LeaderPosition> | null;
  /** Lighter account index, looked up once (null: none yet, looked up again later). */
  account?: { index: number | null; at: number };
}

function parseLeader(raw: unknown): LeaderState {
  if (typeof raw !== "string") return { positions: null };
  try {
    const parsed = JSON.parse(raw) as Partial<LeaderState>;
    return { positions: parsed.positions && typeof parsed.positions === "object" ? parsed.positions : null, account: parsed.account };
  } catch {
    return { positions: null };
  }
}

/** The last seen state of these followed wallets (`source:address`), in one command. */
export async function readLeaders(keys: string[]): Promise<Record<string, LeaderState>> {
  if (keys.length === 0) return {};
  const raws = !redisConfig() ? keys.map((key) => memory.leaders.get(key)) : ((await redisPipeline([["HMGET", LEADERS, ...keys]]))[0] as unknown[]);
  return Object.fromEntries(keys.map((key, index) => [key, parseLeader(Array.isArray(raws) ? raws[index] : undefined)]));
}

export async function saveLeaders(states: Record<string, LeaderState>) {
  const entries = Object.entries(states);
  if (entries.length === 0) return;
  if (!redisConfig()) {
    for (const [key, state] of entries) memory.leaders.set(key, JSON.stringify(state));
    return;
  }
  await redisPipeline([["HSET", LEADERS, ...entries.flatMap(([key, state]) => [key, JSON.stringify(state)])]]);
}

export async function readSettings(id: string): Promise<AlertSettings> {
  if (!redisConfig()) return parseStoredSettings(memory.settings.get(id));
  const [raw] = await redisPipeline([["HGET", SETTINGS, id]]);
  return parseStoredSettings(typeof raw === "string" ? raw : null);
}

export async function saveSettings(id: string, settings: AlertSettings) {
  const json = JSON.stringify(settings);
  if (!redisConfig()) return void memory.settings.set(id, json);
  await redisPipeline([["HSET", SETTINGS, id, json]]);
}

/** Every profile's settings and state, for the tick. */
export async function readAll(): Promise<Array<{ id: string; settings: AlertSettings; state: AlertState }>> {
  let settings: Record<string, string>;
  let states: Record<string, string>;
  if (!redisConfig()) {
    settings = Object.fromEntries(memory.settings);
    states = Object.fromEntries(memory.state);
  } else {
    const [rawSettings, rawStates] = await redisPipeline([
      ["HGETALL", SETTINGS],
      ["HGETALL", STATE],
    ]);
    settings = toHash(rawSettings);
    states = toHash(rawStates);
  }
  return Object.entries(settings).map(([id, raw]) => ({ id, settings: parseStoredSettings(raw), state: parseState(states[id]) }));
}

function parseState(raw: string | undefined): AlertState {
  if (!raw) return EMPTY_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<AlertState>;
    return {
      positions: parsed.positions && typeof parsed.positions === "object" ? parsed.positions : null,
      liqWarned: Array.isArray(parsed.liqWarned) ? parsed.liqWarned.map(String) : [],
      firedPrices: Array.isArray(parsed.firedPrices) ? parsed.firedPrices.map(String) : [],
      lighterAccounts: parsed.lighterAccounts && typeof parsed.lighterAccounts === "object" ? parsed.lighterAccounts : undefined,
    };
  } catch {
    return EMPTY_STATE;
  }
}

/** The price alerts that already fired, for the page. */
export async function readFiredPrices(id: string): Promise<string[]> {
  if (!redisConfig()) return parseState(memory.state.get(id)).firedPrices;
  const [raw] = await redisPipeline([["HGET", STATE, id]]);
  return parseState(typeof raw === "string" ? raw : undefined).firedPrices;
}

/** Writes every changed state in one command. */
export async function saveStates(states: Array<{ id: string; state: AlertState }>) {
  if (states.length === 0) return;
  if (!redisConfig()) {
    for (const { id, state } of states) memory.state.set(id, JSON.stringify(state));
    return;
  }
  await redisPipeline([["HSET", STATE, ...states.flatMap(({ id, state }) => [id, JSON.stringify(state)])]]);
}

export async function readNewsCursor(): Promise<number> {
  if (!redisConfig()) return memory.cursor;
  const [raw] = await redisPipeline([["GET", NEWS_CURSOR]]);
  return Number(raw) || 0;
}

export async function saveNewsCursor(cursor: number) {
  if (!redisConfig()) return void (memory.cursor = cursor);
  await redisPipeline([["SET", NEWS_CURSOR, cursor]]);
}

/** One tick at a time: a slow tick must not overlap the next minute's. */
export async function takeTickLock(seconds = 55) {
  if (!redisConfig()) return true;
  const [result] = await redisPipeline([["SET", LOCK, "1", "NX", "EX", seconds]]);
  return result === "OK";
}

export async function releaseTickLock() {
  if (redisConfig()) await redisPipeline([["DEL", LOCK]]);
}

/** A one-time code the user sends to the bot (`/start <code>`) to link a Telegram chat to the profile. */
export async function createTelegramLink(id: string) {
  const code = randomBytes(9).toString("base64url");
  if (!redisConfig()) memory.links.set(code, id);
  else await redisPipeline([["SET", `${PREFIX}:telegram-link:${code}`, id, "EX", LINK_TTL_SECONDS]]);
  return code;
}

/** Links the chat to the profile the code was made for; answers that profile id, or null for an unknown code. */
export async function claimTelegramLink(code: string, chatId: string) {
  let id: string | null;
  if (!redisConfig()) {
    id = memory.links.get(code) ?? null;
    memory.links.delete(code);
  } else {
    const [value] = await redisPipeline([["GETDEL", `${PREFIX}:telegram-link:${code}`]]);
    id = typeof value === "string" ? value : null;
  }
  if (!id) return null;
  const settings = await readSettings(id);
  if (settings.telegramChatId && settings.telegramChatId !== chatId) await forgetChat(settings.telegramChatId);
  await saveSettings(id, { ...settings, telegramChatId: chatId });
  if (!redisConfig()) memory.chats.set(chatId, id);
  else await redisPipeline([["HSET", TELEGRAM_CHATS, chatId, id]]);
  return id;
}

async function forgetChat(chatId: string) {
  if (!redisConfig()) return void memory.chats.delete(chatId);
  await redisPipeline([["HDEL", TELEGRAM_CHATS, chatId]]);
}

/** Unlinks a profile's Telegram chat (from the page) and answers the chat id it had. */
export async function unlinkTelegram(id: string) {
  const settings = await readSettings(id);
  if (!settings.telegramChatId) return null;
  await forgetChat(settings.telegramChatId);
  await saveSettings(id, { ...settings, telegramChatId: null });
  return settings.telegramChatId;
}

/** Unlinks whatever profile a chat belongs to (the user sent /stop to the bot). */
export async function unlinkChat(chatId: string) {
  let id: string | null;
  if (!redisConfig()) id = memory.chats.get(chatId) ?? null;
  else {
    const [value] = await redisPipeline([["HGET", TELEGRAM_CHATS, chatId]]);
    id = typeof value === "string" ? value : null;
  }
  if (!id) return false;
  await unlinkTelegram(id);
  return true;
}
