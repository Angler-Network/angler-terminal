import "server-only";
import { deployment } from "@/lib/deployment";
import { readBetaFlag } from "@/lib/profile/beta";
import { redisConfig, redisPipeline } from "@/lib/redis";

/**
 * The closed beta switch, set by admins (Profile → Admin) without a deploy. In Redis per deployment, memory without
 * it. Unset, the beta is closed everywhere but the testnet site (which has no gate). Read on every profile load, so a
 * copy is kept for a few seconds per instance; the instance that flips it sees the change at once, others within
 * CACHE_MS.
 */
const KEY = `angler:ops:${process.env.NEXT_PUBLIC_DEPLOYMENT || "dev"}:closed-beta`;
const CACHE_MS = 15_000;
const memory = ((globalThis as unknown as { __anglerBeta?: { value: string | null } }).__anglerBeta ??= { value: null });
let cached: { at: number; closed: boolean } | null = null;

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
  if (redisConfig()) await redisPipeline([["SET", KEY, value]]);
  else memory.value = value;
  cached = { at: Date.now(), closed };
}
