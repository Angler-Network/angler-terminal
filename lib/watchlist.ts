/**
 * Favorite markets (the ★ in the asset search, the optional Watchlist panel), stored in preferences. Read back from
 * localStorage, so every field is validated. Pure, unit-tested.
 */
export interface WatchlistEntry {
  /** "perp:BTC" for a perp market, the spot listing id ("jupiter:<mint>", "arcus:<address>") for a spot token. */
  id: string;
  kind: "perp" | "spot";
  /** The ticker shown (WBTC). */
  symbol: string;
  /** The terminal asset selected on click (BTC: the chart, news and order panel follow it). */
  asset: string;
  name?: string;
  /** Spot token logo (https only). */
  icon?: string;
  /** Jupiter mint, so the order panel trades this exact token. */
  mint?: string;
}

export const MAX_WATCHLIST = 50;

const ASSET = /^[A-Z0-9]{1,20}$/;
const SYMBOL = /^[\p{L}\p{N}$._-]{1,24}$/u;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function readEntry(value: unknown): WatchlistEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string" || !entry.id || entry.id.length > 100) return null;
  if (entry.kind !== "perp" && entry.kind !== "spot") return null;
  if (typeof entry.symbol !== "string" || !SYMBOL.test(entry.symbol)) return null;
  if (typeof entry.asset !== "string" || !ASSET.test(entry.asset)) return null;
  return {
    id: entry.id,
    kind: entry.kind,
    symbol: entry.symbol,
    asset: entry.asset,
    ...(typeof entry.name === "string" && entry.name.length <= 80 && { name: entry.name }),
    ...(typeof entry.icon === "string" && entry.icon.startsWith("https://") && entry.icon.length <= 500 && { icon: entry.icon }),
    ...(typeof entry.mint === "string" && MINT.test(entry.mint) && { mint: entry.mint }),
  };
}

/** Valid entries, unique by id, at most `MAX_WATCHLIST`. */
export function readWatchlist(value: unknown): WatchlistEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: WatchlistEntry[] = [];
  for (const item of value) {
    const entry = readEntry(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
    if (entries.length >= MAX_WATCHLIST) break;
  }
  return entries;
}

export function isWatched(list: WatchlistEntry[], id: string) {
  return list.some((entry) => entry.id === id);
}

/** Removes the entry when it's there, else adds it first (dropping the oldest past the limit). */
export function toggleWatch(list: WatchlistEntry[], entry: WatchlistEntry): WatchlistEntry[] {
  if (isWatched(list, entry.id)) return list.filter((item) => item.id !== entry.id);
  return [entry, ...list].slice(0, MAX_WATCHLIST);
}

export const perpWatchId = (symbol: string) => `perp:${symbol}`;
