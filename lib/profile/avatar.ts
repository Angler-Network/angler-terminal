/**
 * Deterministic avatar art for a wallet: a curated palette and three blurred blobs placed by a PRNG seeded from the
 * address, so every profile gets a stable, distinct face without uploads. Pure, unit-tested.
 */

/** Hand-picked palettes (background first) that stay pleasant on dark and light themes. */
const PALETTES = [
  ["#0f172a", "#f43f5e", "#f59e0b", "#8b5cf6"],
  ["#0b132b", "#22d3ee", "#a78bfa", "#f472b6"],
  ["#1a1033", "#ff6b6b", "#ffd166", "#06d6a0"],
  ["#052e2b", "#2dd4bf", "#a3e635", "#38bdf8"],
  ["#1f0a1e", "#fb7185", "#c084fc", "#fbbf24"],
  ["#0a1a2f", "#60a5fa", "#34d399", "#f9a8d4"],
  ["#231942", "#e0b1cb", "#9f86c0", "#5e548e"],
  ["#2b0f0e", "#f97316", "#facc15", "#ef4444"],
  ["#0d1b1e", "#7dd3fc", "#fde68a", "#86efac"],
  ["#1b1b3a", "#ff9f1c", "#2ec4b6", "#e71d36"],
  ["#10002b", "#c77dff", "#7b2cbf", "#ff70a6"],
  ["#001219", "#94d2bd", "#ee9b00", "#ae2012"],
] as const;

export interface AvatarBlob {
  cx: number;
  cy: number;
  r: number;
  color: string;
}

export interface AvatarSpec {
  background: string;
  blobs: AvatarBlob[];
  /** Turns the whole picture so blobs from the same palette don't line up the same way. */
  rotation: number;
}

/** FNV-1a over the lowercased id: EVM addresses compare case-insensitively. */
function seedOf(id: string) {
  let hash = 0x811c9dc5;
  for (const char of id.toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: small, fast and good enough to spread positions. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The avatar for a profile id on an 80×80 canvas. */
export function avatarSpec(id: string): AvatarSpec {
  const next = random(seedOf(id));
  const palette = PALETTES[Math.floor(next() * PALETTES.length)];
  const blobs = palette.slice(1).map((color) => ({
    cx: Math.round(10 + next() * 60),
    cy: Math.round(10 + next() * 60),
    r: Math.round(22 + next() * 22),
    color,
  }));
  return { background: palette[0], blobs, rotation: Math.round(next() * 360) };
}
