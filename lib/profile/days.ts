/**
 * Daily volume buckets: a profile's volume per UTC day (the day it was credited), so the profile can show the last 7
 * and 30 days next to the lifetime total. Pure, unit-tested.
 */

/** "2026-10-08" for the UTC day of `time`. */
export function dayKey(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}

/** Volume over the last `days` UTC days, today included. */
export function volumeOverDays(buckets: Record<string, string>, days: number, now = Date.now()) {
  const oldest = dayKey(now - (days - 1) * 86_400_000);
  let total = 0;
  for (const [day, value] of Object.entries(buckets)) {
    const amount = Number(value);
    if (day >= oldest && day <= dayKey(now) && Number.isFinite(amount) && amount > 0) total += amount;
  }
  return Math.round(total * 100) / 100;
}
