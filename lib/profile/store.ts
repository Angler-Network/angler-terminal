import "server-only";
import { redisConfig, redisPipeline, toHash, type RedisCommand } from "@/lib/redis";
import { levelFor, pointsFor, type LevelInfo } from "./levels";
import { profileIdOf, type ProfileChain } from "./identity";

/**
 * Profiles in Redis (`lib/redis.ts`, memory without it), per deployment so testnet points stay apart:
 *   p:{id}          hash: username, usd:{venue}, cursors, links
 *   points          sorted set: id → points (the leaderboard)
 *   name:{lower}    the id holding a username
 *   claim:{tx}      a Solana swap already credited
 *   sync:{id}       a short lock so venue syncs run at most once a minute per profile
 * The one place the terminal keeps wallet addresses: a profile exists once the wallet trades or signs a change.
 */
const PREFIX = `angler:profile:${process.env.NEXT_PUBLIC_DEPLOYMENT || "dev"}`;

export const PROFILE_VENUES = ["hyperliquid", "lighter", "jupiter", "titan"] as const;
export type ProfileVenue = (typeof PROFILE_VENUES)[number];

const CLAIM_TTL_SECONDS = 400 * 86_400;
export const SYNC_INTERVAL_SECONDS = 60;
export const LEADERBOARD_SIZE = 50;

// ---------- storage: a few Redis commands, or the same on in-memory maps ----------

interface MemoryStore {
  hashes: Map<string, Record<string, string>>;
  strings: Map<string, { value: string; expires: number }>;
  sets: Map<string, Set<string>>;
  zset: Map<string, number>;
}

const memory = ((globalThis as unknown as { __anglerProfiles?: MemoryStore }).__anglerProfiles ??= {
  hashes: new Map(),
  strings: new Map(),
  sets: new Map(),
  zset: new Map(),
});

const key = (...parts: string[]) => [PREFIX, ...parts].join(":");

async function run(commands: RedisCommand[]) {
  return redisPipeline(commands);
}

async function getHash(id: string): Promise<Record<string, string>> {
  if (!redisConfig()) return { ...(memory.hashes.get(key("p", id)) ?? {}) };
  const [result] = await run([["HGETALL", key("p", id)]]);
  return toHash(result);
}

async function setFields(id: string, fields: Record<string, string>) {
  if (!redisConfig()) {
    memory.hashes.set(key("p", id), { ...(memory.hashes.get(key("p", id)) ?? {}), ...fields });
    return;
  }
  await run([["HSET", key("p", id), ...Object.entries(fields).flat()]]);
}

async function deleteFields(id: string, fields: string[]) {
  if (!redisConfig()) {
    const hash = memory.hashes.get(key("p", id));
    for (const field of fields) delete hash?.[field];
    return;
  }
  await run([["HDEL", key("p", id), ...fields]]);
}

/** SET NX with an expiry: true when this call took the key. */
async function takeKey(name: string, seconds: number, value = "1") {
  if (!redisConfig()) {
    const now = Date.now();
    const current = memory.strings.get(name);
    if (current && current.expires > now) return false;
    memory.strings.set(name, { value, expires: now + seconds * 1000 });
    return true;
  }
  const [result] = await run([["SET", name, value, "NX", "EX", seconds]]);
  return result === "OK";
}

async function getKey(name: string) {
  if (!redisConfig()) {
    const entry = memory.strings.get(name);
    return entry && entry.expires > Date.now() ? entry.value : null;
  }
  const [result] = await run([["GET", name]]);
  return typeof result === "string" ? result : null;
}

async function dropKey(name: string) {
  if (!redisConfig()) return void memory.strings.delete(name);
  await run([["DEL", name]]);
}

async function setPoints(id: string, points: number) {
  if (!redisConfig()) {
    if (points > 0) memory.zset.set(id, points);
    else memory.zset.delete(id);
    return;
  }
  await run([points > 0 ? ["ZADD", key("points"), points, id] : ["ZREM", key("points"), id]]);
}

async function addToSet(name: string, member: string) {
  if (!redisConfig()) {
    memory.sets.set(name, (memory.sets.get(name) ?? new Set()).add(member));
    return;
  }
  await run([["SADD", name, member]]);
}

async function members(name: string): Promise<string[]> {
  if (!redisConfig()) return [...(memory.sets.get(name) ?? [])];
  const [result] = await run([["SMEMBERS", name]]);
  return Array.isArray(result) ? result.map(String) : [];
}

// ---------- profiles ----------

export interface ProfileView {
  id: string;
  chain: ProfileChain;
  username: string | null;
  points: number;
  level: LevelInfo;
  /** 1-based leaderboard position, null without points. */
  rank: number | null;
  volume: Record<ProfileVenue, number>;
  /** EVM profiles: Solana wallets whose swaps count here. Solana wallets: the profile they count toward. */
  linkedWallets: string[];
  linkedTo: string | null;
}

function volumeOf(hash: Record<string, string>) {
  const volume = {} as Record<ProfileVenue, number>;
  for (const venue of PROFILE_VENUES) {
    const value = Number(hash[`usd:${venue}`] ?? 0);
    volume[venue] = Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  }
  return volume;
}

const totalOf = (volume: Record<ProfileVenue, number>) => PROFILE_VENUES.reduce((sum, venue) => sum + volume[venue], 0);

async function rankOf(id: string): Promise<number | null> {
  if (!redisConfig()) {
    const points = memory.zset.get(id);
    if (!points) return null;
    return [...memory.zset.values()].filter((value) => value > points).length + 1;
  }
  const [result] = await run([["ZREVRANK", key("points"), id]]);
  return typeof result === "number" ? result + 1 : null;
}

export async function readProfile(id: string): Promise<ProfileView> {
  const chain = profileIdOf(id)?.chain ?? "evm";
  const [hash, linked] = await Promise.all([getHash(id), chain === "evm" ? members(key("links", id)) : Promise.resolve([])]);
  const volume = volumeOf(hash);
  const points = pointsFor(totalOf(volume));
  return {
    id,
    chain,
    username: hash.username || null,
    points,
    level: levelFor(points),
    rank: points > 0 ? await rankOf(id) : null,
    volume,
    linkedWallets: linked,
    linkedTo: hash.linkedTo || null,
  };
}

export async function readCursors(id: string) {
  const hash = await getHash(id);
  const number = (field: string) => {
    const value = Number(hash[field]);
    return Number.isFinite(value) ? value : null;
  };
  return { hl: number("hlCursor"), lighter: number("lighterCursor") };
}

export async function saveCursors(id: string, cursors: { hl?: number; lighter?: number }) {
  const fields: Record<string, string> = {};
  if (cursors.hl !== undefined) fields.hlCursor = String(cursors.hl);
  if (cursors.lighter !== undefined) fields.lighterCursor = String(cursors.lighter);
  if (Object.keys(fields).length) await setFields(id, fields);
}

/** Adds verified volume to a profile and moves it on the leaderboard. */
export async function creditVolume(id: string, venue: ProfileVenue, usd: number) {
  if (!(usd > 0)) return;
  const amount = Math.round(usd * 100) / 100;
  if (redisConfig()) {
    await run([["HINCRBYFLOAT", key("p", id), `usd:${venue}`, amount]]);
  } else {
    const hash = memory.hashes.get(key("p", id)) ?? {};
    hash[`usd:${venue}`] = String(Number(hash[`usd:${venue}`] ?? 0) + amount);
    memory.hashes.set(key("p", id), hash);
  }
  await setPoints(id, pointsFor(totalOf(volumeOf(await getHash(id)))));
}

/** The profile a wallet's volume counts toward: a linked Solana wallet's EVM profile, else its own. */
export async function creditTarget(id: string) {
  return (await getHash(id)).linkedTo || id;
}

/** Takes the once-a-minute sync slot for a profile. */
export function takeSyncSlot(id: string) {
  return takeKey(key("sync", id), SYNC_INTERVAL_SECONDS);
}

/** Marks a Solana transaction as credited; false when it already was. */
export function claimTransaction(signature: string) {
  return takeKey(key("claim", signature), CLAIM_TTL_SECONDS);
}

export function releaseTransaction(signature: string) {
  return dropKey(key("claim", signature));
}

export type UsernameResult = { ok: true } | { ok: false; error: string };

/** Sets (or changes) a username; names are unique without regard to case. */
export async function setUsername(id: string, username: string): Promise<UsernameResult> {
  const lower = username.toLowerCase();
  const current = (await getHash(id)).username;
  if (current?.toLowerCase() === lower) {
    await setFields(id, { username });
    return { ok: true };
  }
  // Taken for good (no expiry): a year-long TTL renewed on each change would be the same in practice.
  if (!(await takeKey(key("name", lower), 10 * 365 * 86_400, id))) {
    return (await getKey(key("name", lower))) === id ? { ok: true } : { ok: false, error: "That username is taken." };
  }
  if (current) await dropKey(key("name", current.toLowerCase()));
  await setFields(id, { username });
  return { ok: true };
}

/**
 * Links a Solana wallet to an EVM profile: its volume so far moves over and its future swaps count there.
 * Relinking to another profile moves only what it earns from then on.
 */
export async function linkWallet(solanaId: string, evmId: string) {
  const hash = await getHash(solanaId);
  const volume = volumeOf(hash);
  for (const venue of PROFILE_VENUES) if (volume[venue] > 0) await creditVolume(evmId, venue, volume[venue]);
  await deleteFields(solanaId, PROFILE_VENUES.map((venue) => `usd:${venue}`));
  await setPoints(solanaId, 0);
  if (hash.linkedTo && hash.linkedTo !== evmId) {
    if (redisConfig()) await run([["SREM", key("links", hash.linkedTo), solanaId]]);
    else memory.sets.get(key("links", hash.linkedTo))?.delete(solanaId);
  }
  await setFields(solanaId, { linkedTo: evmId });
  await addToSet(key("links", evmId), solanaId);
}

export interface LeaderboardEntry {
  rank: number;
  id: string;
  username: string | null;
  points: number;
  level: number;
  levelName: string;
}

export async function readLeaderboard(limit = LEADERBOARD_SIZE): Promise<LeaderboardEntry[]> {
  let rows: Array<[string, number]>;
  if (!redisConfig()) {
    rows = [...memory.zset.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  } else {
    const [result] = await run([["ZREVRANGE", key("points"), 0, limit - 1, "WITHSCORES"]]);
    const list = Array.isArray(result) ? result : [];
    rows = [];
    for (let index = 0; index + 1 < list.length; index += 2) rows.push([String(list[index]), Number(list[index + 1])]);
  }
  if (rows.length === 0) return [];
  const names = redisConfig()
    ? (await run(rows.map(([id]) => ["HGET", key("p", id), "username"]))).map((value) => (typeof value === "string" && value ? value : null))
    : rows.map(([id]) => memory.hashes.get(key("p", id))?.username || null);
  return rows.map(([id, points], index) => {
    const level = levelFor(points);
    return { rank: index + 1, id, username: names[index], points, level: level.level, levelName: level.name };
  });
}
