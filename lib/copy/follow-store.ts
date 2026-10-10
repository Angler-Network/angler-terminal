import { readFollows, type Follow } from "./follows";

/**
 * The follow list, what each copy holds, and the copy log, per wallet in localStorage, so a reload or a second tab
 * sees them. Only the tab holding the copy lock (`copy-runner.tsx`) trades; every tab reads and edits.
 */

const FOLLOWS = "angler:follows:";
const BOOK = "angler:copy-book:";
const LOG = "angler:copy-log:";
const MAX_LOG = 60;

/** What one copy holds of one coin: where it lives and its signed base size. */
export interface CopyHolding {
  venue: string;
  coin: string;
  size: number;
}

export interface CopyLogEntry {
  at: number;
  followId: string;
  tone: "success" | "error" | "info";
  text: string;
}

const listeners = new Set<() => void>();

function read(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: this tab keeps going until a reload.
  }
  listeners.forEach((listener) => listener());
}

const user = (address: string) => address.toLowerCase();

export function loadFollows(address: string): Follow[] {
  return readFollows(read(FOLLOWS + user(address)));
}

export function saveFollows(address: string, follows: Follow[]) {
  write(FOLLOWS + user(address), readFollows(follows));
}

export function updateFollows(address: string, change: (follows: Follow[]) => Follow[]) {
  const next = readFollows(change(loadFollows(address)));
  write(FOLLOWS + user(address), next);
  return next;
}

/** Holdings by `followId|coin`. */
export function loadBook(address: string): Record<string, CopyHolding> {
  const value = read(BOOK + user(address));
  if (!value || typeof value !== "object") return {};
  const book: Record<string, CopyHolding> = {};
  for (const [key, entry] of Object.entries(value as Record<string, Partial<CopyHolding>>)) {
    if (typeof entry?.venue === "string" && typeof entry.coin === "string" && Number.isFinite(entry.size) && entry.size !== 0) book[key] = entry as CopyHolding;
  }
  return book;
}

export const bookKey = (followId: string, coin: string) => `${followId}|${coin}`;

/** Adds a filled change (signed base size) to what a copy holds; a holding that reaches zero is dropped. */
export function recordFill(address: string, followId: string, leaderCoin: string, venue: string, coin: string, signedSize: number) {
  const book = loadBook(address);
  const key = bookKey(followId, leaderCoin);
  const current = book[key];
  const size = (current && current.venue === venue ? current.size : 0) + signedSize;
  if (Math.abs(size) < 1e-12) delete book[key];
  else book[key] = { venue, coin, size };
  write(BOOK + user(address), book);
}

export function forgetHoldings(address: string, followId: string) {
  const book = loadBook(address);
  for (const key of Object.keys(book)) if (key.startsWith(`${followId}|`)) delete book[key];
  write(BOOK + user(address), book);
}

export function loadLog(address: string): CopyLogEntry[] {
  const value = read(LOG + user(address));
  return Array.isArray(value) ? value.filter((entry): entry is CopyLogEntry => typeof entry?.text === "string" && typeof entry.at === "number").slice(0, MAX_LOG) : [];
}

export function addLog(address: string, entry: Omit<CopyLogEntry, "at">) {
  write(LOG + user(address), [{ ...entry, at: Date.now() }, ...loadLog(address)].slice(0, MAX_LOG));
}

/** Calls back on changes from this tab or another one. */
export function subscribeCopyStore(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key && [FOLLOWS, BOOK, LOG].some((prefix) => event.key!.startsWith(prefix))) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
