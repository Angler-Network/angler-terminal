/**
 * Icon URLs that failed to load, kept for a week in localStorage so the next visit doesn't walk the same failing
 * fallback chain again (assets without a logo anywhere cost 6-9 failed requests each).
 */
export const ICON_MISSES_KEY = "angler-terminal:icon-misses:v1";
export const ICON_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_ICON_MISSES = 400;

/** Stored misses still within the TTL; anything malformed reads as none. */
export function readIconMisses(raw: string | null, now: number): Map<string, number> {
  const misses = new Map<string, number>();
  if (!raw) return misses;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return misses;
    for (const [url, at] of Object.entries(parsed)) {
      if (typeof at === "number" && now - at < ICON_MISS_TTL_MS && at <= now) misses.set(url, at);
    }
  } catch {}
  return misses;
}

/** The newest `max` misses as JSON. */
export function serializeIconMisses(misses: Map<string, number>, max = MAX_ICON_MISSES): string {
  const newest = [...misses].sort((a, b) => b[1] - a[1]).slice(0, max);
  return JSON.stringify(Object.fromEntries(newest));
}
