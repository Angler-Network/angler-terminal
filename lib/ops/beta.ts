import "server-only";
import { deployment } from "@/lib/deployment";
import { readBetaFlag } from "@/lib/profile/beta";
import { BETA_POINTS_SINCE, betaWindow, type BetaWindow } from "@/lib/profile/beta-points";
import { redisConfig, redisPipeline, type RedisCommand } from "@/lib/redis";

/**
 * The closed beta switch, set by admins (Profile → Admin) without a deploy. In Redis per deployment, memory without
 * it. Unset, the beta is closed everywhere but the testnet site (which has no gate). Read on every profile load, so a
 * copy is kept for a few seconds per instance; the instance that flips it sees the change at once, others within
 * CACHE_MS.
 */
const KEY = `angler:ops:${process.env.NEXT_PUBLIC_DEPLOYMENT || "dev"}:closed-beta`;
const CACHE_MS = 15_000;
/** When the beta first opened (ms), set once: it ends the closed beta points event (`lib/profile/beta-points.ts`). */
const ENDED_KEY = `${KEY}:points-ended`;
const memory = ((globalThis as unknown as { __anglerBeta?: { value: string | null; ended: string | null } }).__anglerBeta ??= { value: null, ended: null });
let cached: { at: number; closed: boolean } | null = null;
let cachedWindow: { at: number; window: BetaWindow } | null = null;

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
  // The first opening after the event started ends it for good (NX: reopening later keeps the first time).
  const ended = !closed && Date.now() > BETA_POINTS_SINCE ? String(Date.now()) : null;
  if (redisConfig()) await redisPipeline([["SET", KEY, value], ...(ended ? [["SET", ENDED_KEY, ended, "NX"] as RedisCommand] : [])]);
  else {
    memory.value = value;
    memory.ended ??= ended;
  }
  cached = { at: Date.now(), closed };
  cachedWindow = null;
}

/**
 * The closed beta points event's span (null on the testnet site, which has no beta). Unreadable: the last copy, else
 * the event counts as still running, like `readClosedBeta` keeps the beta closed.
 */
export async function readBetaWindow(): Promise<BetaWindow> {
  if (deployment === "testnet") return null;
  if (cachedWindow && Date.now() - cachedWindow.at < CACHE_MS) return cachedWindow.window;
  let window: BetaWindow;
  try {
    window = betaWindow(redisConfig() ? (await redisPipeline([["GET", ENDED_KEY]]))[0] : memory.ended);
  } catch {
    window = cachedWindow ? cachedWindow.window : betaWindow(null);
  }
  cachedWindow = { at: Date.now(), window };
  return window;
}
