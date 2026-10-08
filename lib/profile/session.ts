import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { redisConfig, redisPipeline } from "@/lib/redis";

/**
 * Profile sessions: after the wallet signs "Sign in to Angler" once, an httpOnly cookie proves for 30 days that this
 * browser holds the wallet, so private parts of the profile (invite codes) are only sent to their owner.
 * The token is `base64url({ id, exp }).hmac`; the HMAC key lives in Redis (made once), so no extra setting is needed.
 */
export const SESSION_COOKIE = "angler_profile_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 86_400;

const SECRET_KEY = `angler:profile:${process.env.NEXT_PUBLIC_DEPLOYMENT || "dev"}:session-secret`;
let cachedSecret: string | null = null;

async function secret() {
  if (cachedSecret) return cachedSecret;
  const fresh = randomBytes(32).toString("hex");
  if (!redisConfig()) return (cachedSecret = fresh);
  // The first instance to ask sets it; every other one reads the same key.
  const [, current] = await redisPipeline([
    ["SET", SECRET_KEY, fresh, "NX"],
    ["GET", SECRET_KEY],
  ]);
  return (cachedSecret = typeof current === "string" ? current : fresh);
}

function mac(payload: string, key: string) {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export async function createSession(id: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ id, exp: now + SESSION_MAX_AGE_SECONDS * 1000 })).toString("base64url");
  return `${payload}.${mac(payload, await secret())}`;
}

/** The profile id a session cookie was issued to, or null when it's missing, forged or expired. */
export async function sessionId(token: string | undefined, now = Date.now()): Promise<string | null> {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(mac(payload, await secret()));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { id, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { id?: unknown; exp?: unknown };
    return typeof id === "string" && typeof exp === "number" && exp > now ? id : null;
  } catch {
    return null;
  }
}
