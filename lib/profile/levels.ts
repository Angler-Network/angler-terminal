/**
 * Points and levels. One point per dollar traded through the terminal; levels follow the angler theme, from a
 * minnow to a whale. Thresholds grow roughly ×4-5 per level so the top ones stay rare.
 */
export const LEVELS = [
  { name: "Minnow", points: 0 },
  { name: "Perch", points: 1_000 },
  { name: "Trout", points: 5_000 },
  { name: "Bass", points: 25_000 },
  { name: "Pike", points: 100_000 },
  { name: "Salmon", points: 250_000 },
  { name: "Tuna", points: 1_000_000 },
  { name: "Swordfish", points: 5_000_000 },
  { name: "Shark", points: 25_000_000 },
  { name: "Whale", points: 100_000_000 },
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

/** Points earned for a dollar volume: one per whole dollar. */
export function pointsFor(usd: number) {
  return Number.isFinite(usd) && usd > 0 ? Math.floor(usd) : 0;
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
