import "server-only";
import { deployment } from "@/lib/deployment";
import { readBetaFlag } from "@/lib/profile/beta";
import { betaWindows, readBetaLog, type BetaWindow } from "@/lib/profile/beta-points";
import { redisConfig, redisPipeline } from "@/lib/redis";

/**
 * The closed beta switch, set by admins (Profile → Admin) without a deploy. In Redis per deployment, memory without
 * it. Unset, the beta is closed everywhere but the testnet site (which has no gate). Read on every profile load, so a
 * copy is kept for a few seconds per instance; the instance that flips it sees the change at once, others within
 * CACHE_MS.
 */
const KEY = `angler:ops:${process.env.NEXT_PUBLIC_DEPLOYMENT || "dev"}:closed-beta`;
const CACHE_MS = 15_000;
/** Every flip, `"<ms>:<1|0>"` (1 = closed): the closed beta points event follows it (`lib/profile/beta-points.ts`). */
const LOG_KEY = `${KEY}:log`;
const memory = ((globalThis as unknown as { __anglerBeta?: { value: string | null; log: string[] } }).__anglerBeta ??= { value: null, log: [] });
let cached: { at: number; closed: boolean } | null = null;
let cachedWindows: { at: number; windows: BetaWindow[] } | null = null;

const fallback = () => deployment !== "testnet";

export async function readClosedBeta(): Promise<boolean> {
  if (deployment === "testnet") return false;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.closed;
  let closed = fallback();
  try {
    const value = redisConfig() ? (await redisPipeline([["GET", KEY]]))[0] : memory.value;
    closed = readBetaFlag(value, fallback());
  } catch {
    // Unreadable: keep the gate as it was (closed by default) rather than open it by accident.
    closed = cached?.closed ?? fallback();
  }
  cached = { at: Date.now(), closed };
  return closed;
}

export async function setClosedBeta(closed: boolean) {
  const value = closed ? "1" : "0";
  const entry = `${Date.now()}:${value}`;
  if (redisConfig()) await redisPipeline([["SET", KEY, value], ["RPUSH", LOG_KEY, entry]]);
  else {
    memory.value = value;
    memory.log.push(entry);
  }
  cached = { at: Date.now(), closed };
  cachedWindows = null;
}

/**
 * The stretches the closed beta was on since the points event started (none on the testnet site, which has no beta).
 * Unreadable: the last copy, else the beta counts as still closed, like `readClosedBeta`.
 */
export async function readBetaWindows(): Promise<BetaWindow[]> {
  if (deployment === "testnet") return [];
  if (cachedWindows && Date.now() - cachedWindows.at < CACHE_MS) return cachedWindows.windows;
  let windows: BetaWindow[];
  try {
    const log = redisConfig() ? (await redisPipeline([["LRANGE", LOG_KEY, 0, -1]]))[0] : memory.log;
    windows = betaWindows(readBetaLog(log));
  } catch {
    windows = cachedWindows?.windows ?? betaWindows([]);
  }
  cachedWindows = { at: Date.now(), windows };
  return windows;
}
