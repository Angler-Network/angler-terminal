import "server-only";
import { createHash } from "node:crypto";
import { redisConfig, redisPipeline, toHash, type RedisCommand } from "@/lib/redis";
import { dayKey, estimateFeeUsd, lastDays, readServerFeeRates, readTotals, tradeIncrements, type StatsTotals, type TradeEvent } from "./trades";

/**
 * Daily trade totals in Redis (`lib/redis.ts`), so they survive serverless restarts and are shared by every
 * instance. Without Redis (local dev) they live in memory. Only aggregates are stored: no per-trade rows, no wallet,
 * no IP. (Profiles, `lib/profile/store.ts`, are the one place a wallet address is kept: the user opts in by trading.)
 */
const PREFIX = `angler:stats:${process.env.NEXT_PUBLIC_DEPLOYMENT || "dev"}`;
const NEWS_DAYS_KEPT = 90;
/** Events accepted per client per minute; the client key is a hash that expires with the window. */
const RATE_LIMIT_PER_MINUTE = 30;

const memory = (globalThis as unknown as { __anglerStats?: Map<string, Record<string, number>> }).__anglerStats ??= new Map();

function memoryIncrement(key: string, fields: Array<[string, number]>) {
  const hash = memory.get(key) ?? {};
  for (const [field, amount] of fields) hash[field] = (hash[field] ?? 0) + amount;
  memory.set(key, hash);
}

export function analyticsBackend() {
  return redisConfig() ? "redis" : "memory";
}

/** Whether this client may send another event this minute. Fails open: analytics never blocks on Redis. */
export async function allowEvent(clientIp: string, now = new Date()) {
  if (!redisConfig()) return true;
  const minute = Math.floor(now.getTime() / 60_000);
  const key = `${PREFIX}:rl:${createHash("sha256").update(`${clientIp}:${minute}`).digest("hex").slice(0, 24)}`;
  try {
    const [count] = await redisPipeline([["INCR", key], ["EXPIRE", key, 60]]);
    return Number(count) <= RATE_LIMIT_PER_MINUTE;
  } catch {
    return true;
  }
}

export async function recordTrade(event: TradeEvent, now = new Date()) {
  const fields = tradeIncrements(event, estimateFeeUsd(event, readServerFeeRates(process.env)));
  const day = dayKey(now);
  if (!redisConfig()) {
    memoryIncrement(`${PREFIX}:day:${day}`, fields);
    memoryIncrement(`${PREFIX}:total`, fields);
    return;
  }
  const commands: RedisCommand[] = [];
  for (const key of [`${PREFIX}:day:${day}`, `${PREFIX}:total`]) {
    // Always the float variant: HINCRBY fails on a field that already holds a decimal.
    for (const [field, amount] of fields) commands.push(["HINCRBYFLOAT", key, field, amount]);
  }
  if (event.newsId) {
    const newsKey = `${PREFIX}:news:${day}`;
    commands.push(["ZINCRBY", newsKey, event.usd || 0, event.newsId], ["EXPIRE", newsKey, NEWS_DAYS_KEPT * 86_400]);
  }
  try {
    await redisPipeline(commands);
  } catch (error) {
    console.warn(`[analytics] couldn't record a trade: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface StatsSnapshot {
  backend: "redis" | "memory";
  total: StatsTotals;
  /** Oldest first, one entry per UTC day. */
  days: Array<{ date: string } & StatsTotals>;
}

export async function readStats(dayCount = 30, now = new Date()): Promise<StatsSnapshot> {
  return readDates(lastDays(now, dayCount));
}

/** All-time totals and the given UTC days (oldest first), e.g. a calendar year for the admin revenue chart. */
export async function readDates(dates: string[]): Promise<StatsSnapshot> {
  if (!redisConfig()) {
    return {
      backend: "memory",
      total: readTotals(memory.get(`${PREFIX}:total`)),
      days: dates.map((date) => ({ date, ...readTotals(memory.get(`${PREFIX}:day:${date}`)) })),
    };
  }
  const results = await redisPipeline([["HGETALL", `${PREFIX}:total`], ...dates.map((date) => ["HGETALL", `${PREFIX}:day:${date}`])]);
  return {
    backend: "redis",
    total: readTotals(toHash(results[0])),
    days: dates.map((date, index) => ({ date, ...readTotals(toHash(results[index + 1])) })),
  };
}

/** News items with the most traded volume over the last `dayCount` days (Redis only). */
export async function readTopNews(dayCount = 7, limit = 20, now = new Date()) {
  if (!redisConfig()) return [];
  const keys = lastDays(now, dayCount).map((date) => `${PREFIX}:news:${date}`);
  const results = await redisPipeline(keys.map((key) => ["ZRANGE", key, 0, -1, "WITHSCORES"]));
  const totals = new Map<string, number>();
  for (const result of results) {
    const list = Array.isArray(result) ? result : [];
    for (let index = 0; index + 1 < list.length; index += 2) {
      const id = String(list[index]);
      totals.set(id, (totals.get(id) ?? 0) + Number(list[index + 1]));
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([newsId, usd]) => ({ newsId, usd: Math.round(usd * 100) / 100 }));
}

const budgetMemory = (globalThis as unknown as { __anglerBudgets?: Map<string, number> }).__anglerBudgets ??= new Map();

/**
 * Takes one unit of a named daily budget (UTC day); false once `limit` is used up. Shared through Redis when it's
 * configured, per server instance otherwise. A Redis error falls back to the instance counter rather than blocking.
 */
export async function takeDailyBudget(name: string, limit: number, now = new Date()) {
  const key = `${PREFIX}:budget:${name}:${now.toISOString().slice(0, 10)}`;
  if (redisConfig()) {
    try {
      const [count] = await redisPipeline([["INCR", key], ["EXPIRE", key, 2 * 86_400]]);
      return Number(count) <= limit;
    } catch {}
  }
  const count = (budgetMemory.get(key) ?? 0) + 1;
  budgetMemory.set(key, count);
  return count <= limit;
}
