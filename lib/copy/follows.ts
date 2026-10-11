import type { PerpVenueId } from "@/lib/venues/types";

/**
 * Followed wallets (the /copy page): a Hyperliquid or Lighter address whose public positions the terminal watches,
 * with optional alerts (sent by the server, see `lib/alerts`) and optional copying (done by this browser while a tab is
 * open: the trading keys never leave it). Pure: shared by the page, the copy runner and the alerts API.
 */

/** Venues whose positions anyone can read by address (Aster and Orderly need the account's own signed key). */
export const FOLLOW_SOURCES = ["hyperliquid", "lighter", "lighterRh"] as const;
export type FollowSource = (typeof FOLLOW_SOURCES)[number];

export const FOLLOW_SOURCE_NAMES: Record<FollowSource, string> = { hyperliquid: "Hyperliquid", lighter: "Lighter", lighterRh: "Lighter RH" };

/** Where a copied order goes: the leader's own venue, the cheapest one listing the coin, or a fixed venue. */
export type CopyTarget = "same" | "best" | PerpVenueId;

export interface CopySettings {
  enabled: boolean;
  /** "fixed": every position the leader opens is copied at `usd`; "ratio": at `ratio` percent of the leader's size in USD. */
  sizing: "fixed" | "ratio";
  usd: number;
  ratio: number;
  /** Cap per copied position, in USD. */
  maxUsd: number;
  leverage: number;
  target: CopyTarget;
  /** Only these terminal symbols; empty copies every coin. */
  coins: string[];
}

export interface Follow {
  /** `source:address`, unique per list. */
  id: string;
  source: FollowSource;
  /** Lowercase 0x address. */
  address: string;
  label: string;
  addedAt: number;
  /** Telegram / Discord message when its positions change (needs the profile's alerts set up). */
  notify: boolean;
  copy: CopySettings;
}

export const MAX_FOLLOWS = 20;
/** Copying polls each leader every few seconds, so fewer of them may copy at once. */
export const MAX_COPYING = 5;
export const MAX_LABEL = 24;

export const DEFAULT_COPY: CopySettings = { enabled: false, sizing: "fixed", usd: 100, ratio: 1, maxUsd: 1_000, leverage: 3, target: "same", coins: [] };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TARGETS: string[] = ["same", "best", "hyperliquid", "lighter", "lighterRh", "aster", "orderly", "extended", "qfex"];
const SYMBOL = /^[A-Za-z0-9]{1,20}$/;

export function followId(source: FollowSource, address: string) {
  return `${source}:${address.toLowerCase()}`;
}

export function isFollowSource(value: unknown): value is FollowSource {
  return (FOLLOW_SOURCES as readonly unknown[]).includes(value);
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** The name shown for a followed wallet: its label, else the short address. */
export function followName(follow: Pick<Follow, "label" | "address">) {
  return follow.label || shortAddress(follow.address);
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function readCopySettings(value: unknown): CopySettings {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const coins = Array.isArray(input.coins)
    ? [...new Set(input.coins.filter((coin): coin is string => typeof coin === "string" && SYMBOL.test(coin.trim())).map((coin) => coin.trim().toUpperCase()))].slice(0, 30)
    : [];
  return {
    enabled: input.enabled === true,
    sizing: input.sizing === "ratio" ? "ratio" : "fixed",
    usd: clamp(input.usd, 1, 1_000_000, DEFAULT_COPY.usd),
    ratio: clamp(input.ratio, 0.01, 100, DEFAULT_COPY.ratio),
    maxUsd: clamp(input.maxUsd, 1, 10_000_000, DEFAULT_COPY.maxUsd),
    leverage: Math.round(clamp(input.leverage, 1, 50, DEFAULT_COPY.leverage)),
    target: typeof input.target === "string" && TARGETS.includes(input.target) ? (input.target as CopyTarget) : "same",
    coins,
  };
}

/** One followed wallet from storage or a request, or null when it isn't valid. */
export function readFollow(value: unknown): Follow | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (!isFollowSource(input.source) || typeof input.address !== "string" || !ADDRESS.test(input.address)) return null;
  const address = input.address.toLowerCase();
  const label = typeof input.label === "string" ? input.label.trim().replace(/\s+/g, " ").slice(0, MAX_LABEL) : "";
  return {
    id: followId(input.source, address),
    source: input.source,
    address,
    label,
    addedAt: Number.isFinite(Number(input.addedAt)) ? Number(input.addedAt) : 0,
    notify: input.notify === true,
    copy: readCopySettings(input.copy),
  };
}

/** A valid list: duplicates dropped, at most `MAX_FOLLOWS`, at most `MAX_COPYING` copying. */
export function readFollows(value: unknown): Follow[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  let copying = 0;
  const list: Follow[] = [];
  for (const entry of value) {
    const follow = readFollow(entry);
    if (!follow || seen.has(follow.id)) continue;
    seen.add(follow.id);
    if (follow.copy.enabled && ++copying > MAX_COPYING) follow.copy = { ...follow.copy, enabled: false };
    list.push(follow);
    if (list.length >= MAX_FOLLOWS) break;
  }
  return list;
}

/** What the server keeps for alerts: only the wallets the user wants messages about, without the copy settings. */
export interface WatchedWallet {
  source: FollowSource;
  address: string;
  label: string;
}

export function readWatchedWallets(value: unknown): WatchedWallet[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_FOLLOWS) return null;
  const seen = new Set<string>();
  const list: WatchedWallet[] = [];
  for (const entry of value) {
    const follow = readFollow({ ...(entry as object), copy: undefined });
    if (!follow) return null;
    if (seen.has(follow.id)) continue;
    seen.add(follow.id);
    list.push({ source: follow.source, address: follow.address, label: follow.label });
  }
  return list;
}
