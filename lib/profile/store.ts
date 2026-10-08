import "server-only";
import { randomInt } from "node:crypto";
import { redisConfig, redisPipeline, toHash, type RedisCommand } from "@/lib/redis";
import { dayKey, volumeOverDays } from "./days";
import { INVITE_VOLUME } from "./invites";
import { levelFor, pointsFor, REFERRAL_SHARE, type LevelInfo } from "./levels";
import type { EnsIdentity } from "./ens";
import { profileIdOf, type ProfileChain } from "./identity";

/**
 * Profiles in Redis (`lib/redis.ts`, memory without it), per deployment so testnet points stay apart:
 *   p:{id}          hash: username, usd:{venue}, cursors, links
 *   d:{id}          hash: UTC day → volume credited that day (7 and 30 day totals)
 *   inv:{id}        hash: invite code → the profile that used it ("" while unused)
 *   invite:{code}   the profile that owns an invite code; invite-used:{code} the profile that used it
 *   points          sorted set: id → points (the leaderboard)
 *   name:{lower}    the id holding a username
 *   claim:{tx}      a Solana swap already credited
 *   sync:{id}       a short lock so venue syncs run at most once a minute per profile
 * The one place the terminal keeps wallet addresses: a profile exists once the wallet trades or signs a change.
 */
const PREFIX = `angler:profile:${process.env.NEXT_PUBLIC_DEPLOYMENT || "dev"}`;

export const PROFILE_VENUES = ["hyperliquid", "lighter", "lighterRh", "jupiter", "titan"] as const;
export type ProfileVenue = (typeof PROFILE_VENUES)[number];

/** Perp and order-book spot venues: only their volume earns invites and referral rewards (not swaps or bridges). */
const TRADING_VENUES: ProfileVenue[] = ["hyperliquid", "lighter", "lighterRh"];

/** A referrer's cash share of the Angler fees its referrals pay on perp and spot trades. */
export const REFERRAL_FEE_SHARE = 0.1;

const CLAIM_TTL_SECONDS = 400 * 86_400;
/** Daily buckets outlive the longest window shown; the hash expires after this long without volume. */
const DAYS_TTL_SECONDS = 400 * 86_400;
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
  /** All venues over the last 7 and 30 days, by the day volume was credited. */
  recentVolume: { d7: number; d30: number };
  /** EVM profiles: Solana wallets whose swaps count here. Solana wallets: the profile they count toward. */
  linkedWallets: string[];
  linkedTo: string | null;
  /** The profile that referred this one, if any. */
  referrer: string | null;
  /** Profiles this one referred, and the points their volume earned it. */
  referrals: number;
  referralPoints: number;
  /** USD a referrer earned: REFERRAL_FEE_SHARE of the fees its referrals paid on perp and spot trades. */
  referralEarnings: number;
  /**
   * Single-use invite codes, one per INVITE_VOLUME of perp and spot volume; a referrer is set only through one. Only
   * sent to the signed-in owner (`readProfile(id, { owner: true })`), else null.
   */
  invites: { codes: Array<{ code: string; usedBy: string | null }>; nextAt: number } | null;
  /** Primary ENS name and avatar (EVM), added by the API route. */
  ens?: EnsIdentity | null;
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
const tradingVolumeOf = (volume: Record<ProfileVenue, number>) => TRADING_VENUES.reduce((sum, venue) => sum + volume[venue], 0);

/** Referred volume (`refUsd`: what referred profiles traded after joining) that counts toward points. */
function referralUsdOf(hash: Record<string, string>) {
  const value = Number(hash.refUsd ?? 0);
  return Number.isFinite(value) && value > 0 ? value * REFERRAL_SHARE : 0;
}

/** Own volume plus the referral share: the points a profile shows and ranks by. */
const pointsOf = (hash: Record<string, string>) => pointsFor(totalOf(volumeOf(hash)) + referralUsdOf(hash));

async function rankOf(id: string): Promise<number | null> {
  if (!redisConfig()) {
    const points = memory.zset.get(id);
    if (!points) return null;
    return [...memory.zset.values()].filter((value) => value > points).length + 1;
  }
  const [result] = await run([["ZREVRANK", key("points"), id]]);
  return typeof result === "number" ? result + 1 : null;
}

export async function readProfile(id: string, { owner = false }: { owner?: boolean } = {}): Promise<ProfileView> {
  const chain = profileIdOf(id)?.chain ?? "evm";
  const [hash, days, linked, referred] = await Promise.all([
    getHash(id),
    readDays(id),
    chain === "evm" ? members(key("links", id)) : Promise.resolve([]),
    members(key("refs", id)),
  ]);
  const invites = owner ? await syncInvites(id, tradingVolumeOf(volumeOf(hash))) : null;
  const volume = volumeOf(hash);
  const points = pointsOf(hash);
  return {
    id,
    chain,
    username: hash.username || null,
    points,
    level: levelFor(points),
    rank: points > 0 ? await rankOf(id) : null,
    volume,
    recentVolume: { d7: volumeOverDays(days, 7), d30: volumeOverDays(days, 30) },
    linkedWallets: linked,
    linkedTo: hash.linkedTo || null,
    referrer: hash.referrer || null,
    referrals: referred.length,
    referralEarnings: Math.round(Math.max(0, Number(hash.refFeeUsd) || 0) * 100) / 100,
    invites,
    referralPoints: pointsFor(referralUsdOf(hash)),
  };
}

export async function readCursors(id: string) {
  const hash = await getHash(id);
  const number = (field: string) => {
    const value = Number(hash[field]);
    return Number.isFinite(value) ? value : null;
  };
  return { hl: number("hlCursor"), lighter: number("lighterCursor"), lighterRh: number("lighterRhCursor") };
}

export async function saveCursors(id: string, cursors: { hl?: number; lighter?: number; lighterRh?: number }) {
  const fields: Record<string, string> = {};
  if (cursors.hl !== undefined) fields.hlCursor = String(cursors.hl);
  if (cursors.lighter !== undefined) fields.lighterCursor = String(cursors.lighter);
  if (cursors.lighterRh !== undefined) fields.lighterRhCursor = String(cursors.lighterRh);
  if (Object.keys(fields).length) await setFields(id, fields);
}

async function readDays(id: string): Promise<Record<string, string>> {
  if (!redisConfig()) return { ...(memory.hashes.get(key("d", id)) ?? {}) };
  const [result] = await run([["HGETALL", key("d", id)]]);
  return toHash(result);
}

/** The profile's volume over the last 30 days (its VIP tier). */
export async function volume30d(id: string) {
  return volumeOverDays(await readDays(id), 30);
}

/**
 * Adds verified volume to a profile (lifetime and today's bucket) and moves it on the leaderboard. On perp and spot
 * venues the referrer, if any, earns a share of the points and REFERRAL_FEE_SHARE of `feeUsd`, the Angler fee paid.
 */
export async function creditVolume(id: string, venue: ProfileVenue, usd: number, feeUsd = 0) {
  if (!(usd > 0)) return;
  const amount = Math.round(usd * 100) / 100;
  const today = dayKey(Date.now());
  if (redisConfig()) {
    await run([
      ["HINCRBYFLOAT", key("p", id), `usd:${venue}`, amount],
      ["HINCRBYFLOAT", key("d", id), today, amount],
      ["EXPIRE", key("d", id), DAYS_TTL_SECONDS],
    ]);
  } else {
    const hash = memory.hashes.get(key("p", id)) ?? {};
    hash[`usd:${venue}`] = String(Number(hash[`usd:${venue}`] ?? 0) + amount);
    memory.hashes.set(key("p", id), hash);
    const days = memory.hashes.get(key("d", id)) ?? {};
    days[today] = String(Number(days[today] ?? 0) + amount);
    memory.hashes.set(key("d", id), days);
  }
  const hash = await getHash(id);
  await setPoints(id, pointsOf(hash));
  // The referrer earns a share of this volume and of our fee on it (only perp and spot volume traded after the
  // referral, never a referrer's bonus or swaps).
  if (hash.referrer && TRADING_VENUES.includes(venue)) {
    const share = Math.round(Math.max(0, feeUsd) * REFERRAL_FEE_SHARE * 1e6) / 1e6;
    if (redisConfig()) {
      await run([
        ["HINCRBYFLOAT", key("p", hash.referrer), "refUsd", amount],
        ...(share > 0 ? [["HINCRBYFLOAT", key("p", hash.referrer), "refFeeUsd", share] as RedisCommand] : []),
      ]);
    } else {
      const referrer = await getHash(hash.referrer);
      await setFields(hash.referrer, { refUsd: String(Number(referrer.refUsd ?? 0) + amount), refFeeUsd: String(Number(referrer.refFeeUsd ?? 0) + share) });
    }
    await setPoints(hash.referrer, pointsOf(await getHash(hash.referrer)));
  }
}

/** Codes made in one read at most (a whale's first read after this ships). */
const MAX_NEW_INVITES = 50;
/** Invite codes and their use are kept for good (Redis needs an expiry for SET NX here: a century). */
const INVITE_TTL_SECONDS = 100 * 365 * 86_400;
/** No 0/O or 1/I/L: codes get read out and typed. */
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newInviteCode() {
  return Array.from({ length: 8 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join("");
}

async function readInvites(id: string): Promise<Record<string, string>> {
  if (!redisConfig()) return { ...(memory.hashes.get(key("inv", id)) ?? {}) };
  const [result] = await run([["HGETALL", key("inv", id)]]);
  return toHash(result);
}

async function setInvite(id: string, code: string, usedBy: string) {
  if (!redisConfig()) {
    memory.hashes.set(key("inv", id), { ...(memory.hashes.get(key("inv", id)) ?? {}), [code]: usedBy });
    return;
  }
  await run([["HSET", key("inv", id), code, usedBy]]);
}

/** Tops a profile up to the invite codes its volume earned, and lists them (unused first). */
async function syncInvites(id: string, volume: number): Promise<ProfileView["invites"]> {
  const earned = Math.floor(volume / INVITE_VOLUME);
  const codes = await readInvites(id);
  let missing = Math.min(MAX_NEW_INVITES, earned - Object.keys(codes).length);
  while (missing > 0) {
    const code = newInviteCode();
    // A code is claimed for good (no expiry); a clash just draws another one.
    if (!(await takeKey(key("invite", code), INVITE_TTL_SECONDS, id))) continue;
    await setInvite(id, code, "");
    codes[code] = "";
    missing--;
  }
  const list = Object.entries(codes).map(([code, usedBy]) => ({ code, usedBy: usedBy || null }));
  list.sort((a, b) => Number(Boolean(a.usedBy)) - Number(Boolean(b.usedBy)) || a.code.localeCompare(b.code));
  return { codes: list, nextAt: (earned + 1) * INVITE_VOLUME };
}

export type ReferralResult = { ok: true; referrer: string } | { ok: false; error: string };

/**
 * Sets who referred a profile, once and for good. The code is the referrer's username or wallet address; it must be
 * an existing profile other than this one (and not one this profile referred).
 */
export async function setReferrer(id: string, code: string): Promise<ReferralResult> {
  const own = await getHash(id);
  if (own.referrer) return { ok: false, error: "This profile already has a referrer." };
  // Referral links are for new traders: a profile that already traded through Angler can't pick a referrer later.
  if (totalOf(volumeOf(own)) > 0) return { ok: false, error: "Invites only apply to new profiles." };
  const invite = code.toUpperCase();
  const referrer = await getKey(key("invite", invite));
  if (!referrer) return { ok: false, error: "That invite code doesn't exist." };
  if (referrer === id) return { ok: false, error: "You can't use your own invite." };
  if ((await getHash(referrer)).referrer === id) return { ok: false, error: "That profile was referred by you." };
  // One use per code: the first claim wins.
  if (!(await takeKey(key("invite-used", invite), INVITE_TTL_SECONDS, id))) return { ok: false, error: "That invite was already used." };
  await setFields(id, { referrer });
  await addToSet(key("refs", referrer), id);
  await setInvite(referrer, invite, id);
  return { ok: true, referrer };
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
  /** Primary ENS name and avatar (EVM), added by the API route. */
  ens?: EnsIdentity | null;
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
