/**
 * Points and levels. 10 points per $100,000 traded through the terminal (0.01 per $100); a multiplier for holding
 * positions comes later. Levels follow the angler theme, from a minnow to a whale, set by volume: Perch at $1k, Pike at
 * $100k, Whale at $100M (multipliers reach them sooner). Thresholds grow roughly ×4-5 per level so the top ones stay rare.
 */
export const LEVELS = [
  { name: "Minnow", points: 0 },
  { name: "Perch", points: 0.1 },
  { name: "Trout", points: 0.5 },
  { name: "Bass", points: 2.5 },
  { name: "Pike", points: 10 },
  { name: "Salmon", points: 25 },
  { name: "Tuna", points: 100 },
  { name: "Swordfish", points: 500 },
  { name: "Shark", points: 2_500 },
  { name: "Whale", points: 10_000 },
] as const;

export interface LevelInfo {
  /** 1-based. */
  level: number;
  name: string;
  /** Points where this level starts and the next one does (null at the top). */
  floor: number;
  next: number | null;
  nextName: string | null;
  /** 0-1 through this level. */
  progress: number;
}

/** Share of a referred user's volume that counts toward the referrer's points (their own points are untouched). */
export const REFERRAL_SHARE = 0.1;

/**
 * Points multiplier while the closed beta is on (mainnet): volume credited then earns this many times its points. The
 * extra is stored apart (`bonusUsd`), so volume totals, VIP tiers, invites and referrers' shares stay at 1x.
 */
export const BETA_POINTS_MULTIPLIER = 2;

/** Points per dollar of volume. */
export const POINTS_PER_USD = 0.0001;

/** Points earned for a dollar volume: 0.01 per whole $100, kept to two decimals. */
export function pointsFor(usd: number) {
  return Number.isFinite(usd) && usd > 0 ? Math.floor(usd / 100) / 100 : 0;
}

export function levelFor(points: number): LevelInfo {
  const safe = Number.isFinite(points) && points > 0 ? points : 0;
  let index = 0;
  while (index + 1 < LEVELS.length && safe >= LEVELS[index + 1].points) index++;
  const floor = LEVELS[index].points;
  const next = index + 1 < LEVELS.length ? LEVELS[index + 1] : null;
  return {
    level: index + 1,
    name: LEVELS[index].name,
    floor,
    next: next?.points ?? null,
    nextName: next?.name ?? null,
    progress: next ? Math.min(1, (safe - floor) / (next.points - floor)) : 1,
  };
}
