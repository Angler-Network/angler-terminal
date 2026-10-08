import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-IP request limits for the routes that spend our keys or quotas (Jupiter, Titan, Uniswap, Arcus, Relay, LI.FI,
 * Across, the aggregators, our Solana RPC, GeckoTerminal, the Angler API). Their only other guard is the Origin check,
 * which a script can fake, so without this anyone could run their bot on our API keys.
 *
 * Kept in memory per server instance, fixed one-minute windows: free and adds no latency to quotes that refresh every
 * few seconds (the Redis limiter in `lib/analytics/store.ts` costs two commands a call). Vercel reuses warm instances,
 * so a single client hammering a route meets the limit; the limits sit well above what one busy browser sends, since
 * several people can share an IP (offices, mobile carriers).
 */

export const RATE_LIMITS = {
  /** Quotes, prices, token lookups, balances, charts: polled while a swap card or chart is open. */
  read: 240,
  /** Sending a signed transaction or order. */
  send: 30,
  /** Expensive upstream calls (holder lists over our Solana RPC). */
  heavy: 30,
} as const;

export type RateTier = keyof typeof RATE_LIMITS;

const WINDOW_MS = 60_000;
/** Above this many tracked keys, finished windows are dropped before counting. */
const MAX_KEYS = 20_000;

export function createRateLimiter(now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  return function allow(key: string, limit: number) {
    const time = now();
    if (windows.size > MAX_KEYS) {
      for (const [entry, window] of windows) if (time - window.start >= WINDOW_MS) windows.delete(entry);
    }
    const window = windows.get(key);
    if (!window || time - window.start >= WINDOW_MS) {
      windows.set(key, { start: time, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= limit;
  };
}

const allow = createRateLimiter();

/** The caller's IP as Vercel reports it (x-real-ip, else the first x-forwarded-for hop). */
export function requestIp(request: Pick<NextRequest, "headers">) {
  return request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** A 429 when this IP is over the route's limit this minute, else null. `scope` separates routes (e.g. "jup"). */
export function rateLimited(request: Pick<NextRequest, "headers">, scope: string, tier: RateTier = "read") {
  if (allow(`${scope}:${tier}:${requestIp(request)}`, RATE_LIMITS[tier])) return null;
  return NextResponse.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429, headers: { "retry-after": "60" } });
}
