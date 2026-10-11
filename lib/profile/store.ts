import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import { deployment } from "@/lib/deployment";
import { redisConfig, redisPipeline, toHash, type RedisCommand } from "@/lib/redis";
import { readDiscordConfig } from "@/lib/discord/roles";
import { readClosedBeta } from "@/lib/ops/beta";
import { isAdmin } from "./admin";
import { hasAccess, inviteUsable, mintsInvites } from "./beta";
import { dailyVolume, dayKey, volumeOverDays } from "./days";
import { INVITE_VOLUME } from "./invites";
import { BETA_POINTS_MULTIPLIER, levelFor, pointsFor, REFERRAL_SHARE, type LevelInfo } from "./levels";
import type { EnsIdentity } from "./ens";
import { profileIdOf, type ProfileChain } from "./identity";

/**
 * Profiles in Redis (`lib/redis.ts`, memory without it), per deployment so testnet points stay apart:
 *   p:{id}          hash: username, usd:{venue}, bonusUsd (closed beta extra), cursors, links
 *   d:{id}          hash: UTC day → volume credited that day (7 and 30 day totals)
 *   bd:{id}         hash: UTC day → closed beta bonus volume credited that day (the points history)
 *   inv:{id}        hash: invite code → the profile that used it ("" while unused)
 *   invite:{code}   the profile that owns an invite code; invite-used:{code} the profile that used it
 *   earners         set: profiles that earned referral fees (the admin payout list)
 *   payouts:{id}    hash: payout id → JSON record of a referral payout an admin made
 *   points          sorted set: id → points (the leaderboard)
 *   name:{lower}    the id holding a username
 *   claim:{tx}      a Solana swap already credited
 *   extended:{acct} the profile an Extended account is linked to (one profile per account)
 *   sync:{id}       a short lock so venue syncs run at most once a minute per profile
 * The one place the terminal keeps wallet addresses: a profile exists once the wallet trades or signs a change.
 */
const PREFIX = `angler:profile:${process.env.NEXT_PUBLIC_DEPLOYMENT || "dev"}`;

export const PROFILE_VENUES = ["hyperliquid", "lighter", "lighterRh", "aster", "orderly", "extended", "jupiter", "titan", "uniswap", "zerox", "kyberswap", "arcus", "polymarket", "relay", "lifi", "across"] as const;
export type ProfileVenue = (typeof PROFILE_VENUES)[number];

/** Perp and order-book spot venues: only their volume earns invites and referral rewards (not swaps or bridges). */
const TRADING_VENUES: ProfileVenue[] = ["hyperliquid", "lighter", "lighterRh", "aster", "orderly", "extended"];

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

/** A key with no expiry (an index such as Discord account → profile). */
async function putKey(name: string, value: string) {
  if (!redisConfig()) return void memory.strings.set(name, { value, expires: Number.POSITIVE_INFINITY });
  await run([["SET", name, value]]);
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
  /**
   * Volume credited per UTC day over the last 30 days, oldest first (the points history), with the closed beta bonus
   * volume (`bonusUsd`: extra volume that earns points only) credited that day.
   */
  daily: Array<{ date: string; usd: number; bonusUsd: number }>;
  /** EVM profiles: Solana wallets whose swaps count here. Solana wallets: the profile they count toward. */
  linkedWallets: string[];
  linkedTo: string | null;
  /** The profile that referred this one, if any. */
  referrer: string | null;
  /**
   * Closed beta: in through an invite (a referrer), an admin, or a profile that traded through Angler before the beta.
   * Everyone else is asked for an invite code.
   */
  access: boolean;
  /** An admin wallet (`ANGLER_ADMINS`): creates invite codes at will. */
  admin: boolean;
  /** Profiles this one referred, and the points their volume earned it. */
  referrals: number;
  referralPoints: number;
  /** USD a referrer earned: REFERRAL_FEE_SHARE of the fees its referrals paid on perp and spot trades. */
  referralEarnings: number;
  /** Paid out so far by admins (Discord tickets), and what's left to claim. */
  referralPaid: number;
  referralClaimable: number;
  /**
   * Single-use invite codes, one per INVITE_VOLUME of perp and spot volume; a referrer is set only through one. Only
   * sent to the signed-in owner (`readProfile(id, { owner: true })`), else null.
   */
  invites: {
    codes: Array<{ code: string; usedBy: string | null }>;
    nextAt: number;
    /** Closed beta: only admins hand out invites, so trading earns none until it opens (codes from before wait). */
    paused: boolean;
  } | null;
  /** The closed beta is on (`lib/ops/beta.ts`): the gate shows and only admins' invites let people in. */
  closedBeta: boolean;
  /**
   * Discord roles for the level and VIP tier (`lib/discord/*`): whether the site offers them, and the linked account's
   * name for the signed-in owner only (which Discord account a wallet uses stays private: null for everyone else).
   */
  discord: { enabled: boolean; name: string | null };
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
/**
 * Lighter volume a Standard account traded (no Lighter fee, so none of ours) earns this share of points; Plus and
 * Premium volume earns full points. The volume itself still counts in full (profile totals, VIP, invites).
 */
export const STANDARD_POINTS_SHARE = 0.5;

/**
 * Volume that earned only part of its points: `half:{venue}` (Standard Lighter, less the share it did earn) and
 * `less:{venue}` (volume left out of points where our fee is below the perp base, `pointsShareFor`).
 */
function reducedUsdOf(hash: Record<string, string>) {
  let reduced = 0;
  for (const venue of PROFILE_VENUES) {
    const half = Number(hash[`half:${venue}`] ?? 0);
    if (Number.isFinite(half) && half > 0) reduced += half * (1 - STANDARD_POINTS_SHARE);
    const less = Number(hash[`less:${venue}`] ?? 0);
    if (Number.isFinite(less) && less > 0) reduced += less;
  }
  return reduced;
}

/** Extra volume credited during the closed beta (`BETA_POINTS_MULTIPLIER`): it earns points and nothing else. */
function bonusUsdOf(hash: Record<string, string>) {
  const value = Number(hash.bonusUsd ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

const pointsOf = (hash: Record<string, string>) =>
  pointsFor(Math.max(0, totalOf(volumeOf(hash)) - reducedUsdOf(hash)) + bonusUsdOf(hash) + referralUsdOf(hash));

async function rankOf(id: string): Promise<number | null> {
  if (!redisConfig()) {
    const points = memory.zset.get(id);
    if (!points) return null;
    return [...memory.zset.values()].filter((value) => value > points).length + 1;
  }
  const [result] = await run([["ZREVRANK", key("points"), id]]);
  return typeof result === "number" ? result + 1 : null;
}

const cents = (value: number) => Math.round(value * 100) / 100;

/** Referral fees earned (all time), paid out, and still claimable. */
function referralBalance(hash: Record<string, string>) {
  const earned = Math.max(0, Number(hash.refFeeUsd) || 0);
  const paid = Math.max(0, Number(hash.refPaidUsd) || 0);
  return { referralEarnings: cents(earned), referralPaid: cents(paid), referralClaimable: cents(Math.max(0, earned - paid)) };
}

export async function readProfile(id: string, { owner = false }: { owner?: boolean } = {}): Promise<ProfileView> {
  const chain = profileIdOf(id)?.chain ?? "evm";
  const [hash, days, bonusDays, linked, referred] = await Promise.all([
    getHash(id),
    readDays(id),
    readDays(id, "bd"),
    chain === "evm" ? members(key("links", id)) : Promise.resolve([]),
    members(key("refs", id)),
  ]);
  const closedBeta = await readClosedBeta();
  const invites = owner ? await syncInvites(id, tradingVolumeOf(volumeOf(hash)), closedBeta) : null;
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
    daily: withBonus(dailyVolume(days, 30), dailyVolume(bonusDays, 30)),
    linkedWallets: linked,
    linkedTo: hash.linkedTo || null,
    referrer: hash.referrer || null,
    // The testnet site is open to everyone (no real funds); the closed beta gates mainnet only, while it's on.
    access: hasAccess({ testnet: deployment === "testnet", closedBeta, admin: isAdmin(id), referred: Boolean(hash.referrer), traded: totalOf(volume) > 0 }),
    closedBeta,
    admin: isAdmin(id),
    referrals: referred.length,
    ...referralBalance(hash),
    invites,
    referralPoints: pointsFor(referralUsdOf(hash)),
    discord: { enabled: readDiscordConfig(process.env) !== null, name: owner && hash.discordId ? hash.discordName || "Discord account" : null },
  };
}

export async function readCursors(id: string) {
  const hash = await getHash(id);
  const number = (field: string) => {
    const value = Number(hash[field]);
    return Number.isFinite(value) ? value : null;
  };
  return {
    hl: number("hlCursor"),
    lighter: number("lighterCursor"),
    lighterRh: number("lighterRhCursor"),
    aster: number("asterCursor"),
    orderly: number("orderlyCursor"),
    polymarket: number("polymarketCursor"),
    extended: number("extendedCursor"),
  };
}

export async function saveCursors(id: string, cursors: { hl?: number; lighter?: number; lighterRh?: number; aster?: number; orderly?: number; polymarket?: number; extended?: number }) {
  const fields: Record<string, string> = {};
  if (cursors.hl !== undefined) fields.hlCursor = String(cursors.hl);
  if (cursors.lighter !== undefined) fields.lighterCursor = String(cursors.lighter);
  if (cursors.lighterRh !== undefined) fields.lighterRhCursor = String(cursors.lighterRh);
  if (cursors.aster !== undefined) fields.asterCursor = String(cursors.aster);
  if (cursors.orderly !== undefined) fields.orderlyCursor = String(cursors.orderly);
  if (cursors.polymarket !== undefined) fields.polymarketCursor = String(cursors.polymarket);
  if (cursors.extended !== undefined) fields.extendedCursor = String(cursors.extended);
  if (Object.keys(fields).length) await setFields(id, fields);
}

const withBonus = (days: Array<{ date: string; usd: number }>, bonus: Array<{ date: string; usd: number }>) =>
  days.map((day, index) => ({ ...day, bonusUsd: bonus[index]?.usd ?? 0 }));

async function readDays(id: string, name: "d" | "bd" = "d"): Promise<Record<string, string>> {
  if (!redisConfig()) return { ...(memory.hashes.get(key(name, id)) ?? {}) };
  const [result] = await run([["HGETALL", key(name, id)]]);
  return toHash(result);
}

/** The profile's volume over the last 30 days (its VIP tier). */
export async function volume30d(id: string) {
  return volumeOverDays(await readDays(id), 30);
}

/**
 * Adds verified volume to a profile (lifetime and today's bucket) and moves it on the leaderboard. On perp and spot
 * venues the referrer, if any, earns a share of the points and REFERRAL_FEE_SHARE of `feeUsd`, the Angler fee paid.
 * `betaUsd` (of which `betaStandardUsd` on a Standard Lighter account) is the part traded while the closed beta was on
 * (`beta-points.ts`, by the trade's own time): it earns BETA_POINTS_MULTIPLIER times its points. `pointsShare` (0-1,
 * `pointsShareFor` our fee) scales the points where our fee is below the perp base; the volume still counts in full.
 * Volume moved from a linked wallet passes none: its bonus moves on its own.
 */
export async function creditVolume(
  id: string,
  venue: ProfileVenue,
  usd: number,
  feeUsd = 0,
  standardUsd = 0,
  { betaUsd = 0, betaStandardUsd = 0, pointsShare = 1 }: { betaUsd?: number; betaStandardUsd?: number; pointsShare?: number } = {},
) {
  if (!(usd > 0)) return;
  const amount = Math.round(usd * 100) / 100;
  const shareOfPoints = Number.isFinite(pointsShare) ? Math.min(1, Math.max(0, pointsShare)) : 1;
  // Part of `usd` traded on a Standard Lighter account: recorded so points count it at STANDARD_POINTS_SHARE.
  const standard = Math.round(Math.min(Math.max(0, standardUsd), usd) * 100) / 100;
  const afterStandard = amount - standard * (1 - STANDARD_POINTS_SHARE);
  // What the volume is worth in points, for the referrer's share too; `less` is what our lower fee leaves out.
  const pointsAmount = Math.round(afterStandard * shareOfPoints * 100) / 100;
  const less = Math.round((afterStandard - pointsAmount) * 100) / 100;
  // Closed beta: the extra points, kept as volume that counts for points only.
  const betaPoints = Math.min(pointsAmount, Math.max(0, (betaUsd - Math.max(0, betaStandardUsd) * (1 - STANDARD_POINTS_SHARE)) * shareOfPoints));
  const bonusUsd = Math.round(betaPoints * (BETA_POINTS_MULTIPLIER - 1) * 100) / 100;
  const today = dayKey(Date.now());
  if (redisConfig()) {
    await run([
      ["HINCRBYFLOAT", key("p", id), `usd:${venue}`, amount],
      ...(standard > 0 ? [["HINCRBYFLOAT", key("p", id), `half:${venue}`, standard] as RedisCommand] : []),
      ...(less > 0 ? [["HINCRBYFLOAT", key("p", id), `less:${venue}`, less] as RedisCommand] : []),
      ...(bonusUsd > 0
        ? [
            ["HINCRBYFLOAT", key("p", id), "bonusUsd", bonusUsd] as RedisCommand,
            ["HINCRBYFLOAT", key("bd", id), today, bonusUsd] as RedisCommand,
            ["EXPIRE", key("bd", id), DAYS_TTL_SECONDS] as RedisCommand,
          ]
        : []),
      ["HINCRBYFLOAT", key("d", id), today, amount],
      ["EXPIRE", key("d", id), DAYS_TTL_SECONDS],
    ]);
  } else {
    const hash = memory.hashes.get(key("p", id)) ?? {};
    hash[`usd:${venue}`] = String(Number(hash[`usd:${venue}`] ?? 0) + amount);
    if (standard > 0) hash[`half:${venue}`] = String(Number(hash[`half:${venue}`] ?? 0) + standard);
    if (less > 0) hash[`less:${venue}`] = String(Number(hash[`less:${venue}`] ?? 0) + less);
    if (bonusUsd > 0) hash.bonusUsd = String(Number(hash.bonusUsd ?? 0) + bonusUsd);
    memory.hashes.set(key("p", id), hash);
    const days = memory.hashes.get(key("d", id)) ?? {};
    days[today] = String(Number(days[today] ?? 0) + amount);
    memory.hashes.set(key("d", id), days);
    if (bonusUsd > 0) {
      const bonusDays = memory.hashes.get(key("bd", id)) ?? {};
      bonusDays[today] = String(Number(bonusDays[today] ?? 0) + bonusUsd);
      memory.hashes.set(key("bd", id), bonusDays);
    }
  }
  const hash = await getHash(id);
  await setPoints(id, pointsOf(hash));
  // The referrer earns a share of this volume and of our fee on it (only perp and spot volume traded after the
  // referral, never a referrer's bonus or swaps).
  if (hash.referrer && TRADING_VENUES.includes(venue)) {
    const share = Math.round(Math.max(0, feeUsd) * REFERRAL_FEE_SHARE * 1e6) / 1e6;
    if (redisConfig()) {
      await run([
        ["HINCRBYFLOAT", key("p", hash.referrer), "refUsd", pointsAmount],
        ...(share > 0 ? [["HINCRBYFLOAT", key("p", hash.referrer), "refFeeUsd", share] as RedisCommand, ["SADD", key("earners"), hash.referrer] as RedisCommand] : []),
      ]);
    } else {
      const referrer = await getHash(hash.referrer);
      await setFields(hash.referrer, { refUsd: String(Number(referrer.refUsd ?? 0) + pointsAmount), refFeeUsd: String(Number(referrer.refFeeUsd ?? 0) + share) });
      if (share > 0) await addToSet(key("earners"), hash.referrer);
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

/** One new invite code owned by `id`. */
async function mintInvite(id: string) {
  for (;;) {
    const code = newInviteCode();
    // A code is claimed for good; a clash just draws another one.
    if (!(await takeKey(key("invite", code), INVITE_TTL_SECONDS, id))) continue;
    await setInvite(id, code, "");
    return code;
  }
}

/** An admin's extra invite code (admins aren't limited by volume). Null for everyone else. */
export async function createAdminInvite(id: string) {
  return isAdmin(id) ? mintInvite(id) : null;
}

/**
 * Tops a profile up to the invite codes its volume earned, and lists them (unused first). During the closed beta only
 * admins hand out invites: everyone else gets no new codes and sees none (codes from before come back when it opens).
 */
async function syncInvites(id: string, volume: number, closedBeta: boolean): Promise<ProfileView["invites"]> {
  const earned = Math.floor(volume / INVITE_VOLUME);
  if (!mintsInvites({ closedBeta, admin: isAdmin(id) })) return { codes: [], nextAt: (earned + 1) * INVITE_VOLUME, paused: true };
  const codes = await readInvites(id);
  let missing = Math.min(MAX_NEW_INVITES, earned - Object.keys(codes).length);
  while (missing > 0) {
    codes[await mintInvite(id)] = "";
    missing--;
  }
  const list = Object.entries(codes).map(([code, usedBy]) => ({ code, usedBy: usedBy || null }));
  list.sort((a, b) => Number(Boolean(a.usedBy)) - Number(Boolean(b.usedBy)) || a.code.localeCompare(b.code));
  return { codes: list, nextAt: (earned + 1) * INVITE_VOLUME, paused: false };
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
  // Closed beta: only the team's invites let people in (a trader's earned codes wait until it opens).
  if (!inviteUsable({ closedBeta: await readClosedBeta(), ownerIsAdmin: isAdmin(referrer) })) {
    return { ok: false, error: "During the closed beta only invites from the Angler team work. Ask for one on Discord." };
  }
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

/** The Extended account ids linked to a profile (their builder trades count there). */
export async function readExtendedAccounts(id: string): Promise<number[]> {
  const raw = (await getHash(id)).extendedAccounts ?? "";
  return raw.split(",").map(Number).filter((value) => Number.isSafeInteger(value) && value > 0);
}

export type ExtendedLinkResult = { ok: true; accountId: number } | { ok: false; error: string };

/**
 * Links an Extended account to a profile, proved by the caller holding the account's API key (`extendedAccountOf`). One
 * profile per account: only its own key could link it, so a link can't be taken from its owner.
 */
export async function linkExtendedAccount(id: string, accountId: number): Promise<ExtendedLinkResult> {
  const name = key("extended", String(accountId));
  if (!(await takeKey(name, 10 * 365 * 86_400, id)) && (await getKey(name)) !== id) {
    return { ok: false, error: "That Extended account already counts for another profile." };
  }
  const accounts = await readExtendedAccounts(id);
  if (!accounts.includes(accountId)) await setFields(id, { extendedAccounts: [...accounts, accountId].join(",") });
  return { ok: true, accountId };
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
  // The bonus it earned moves with it; moved volume earns no second bonus.
  for (const venue of PROFILE_VENUES) {
    if (!(volume[venue] > 0)) continue;
    // Volume our lower fee left out of points stays out after the move.
    const less = Number(hash[`less:${venue}`] ?? 0);
    const pointsShare = Number.isFinite(less) && less > 0 ? Math.max(0, 1 - less / volume[venue]) : 1;
    await creditVolume(evmId, venue, volume[venue], 0, 0, { pointsShare });
  }
  const bonusUsd = bonusUsdOf(hash);
  if (bonusUsd > 0) {
    await setFields(evmId, { bonusUsd: String(bonusUsdOf(await getHash(evmId)) + bonusUsd) });
    await setPoints(evmId, pointsOf(await getHash(evmId)));
  }
  await deleteFields(solanaId, [...PROFILE_VENUES.flatMap((venue) => [`usd:${venue}`, `less:${venue}`]), "bonusUsd"]);
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

/**
 * Bump when the points formula changes: the leaderboard's sorted set only moves when a profile gains volume, so profiles
 * idle since a change would keep their old score (one showed 207.85 points for 2.07 after 1 point per $100 became 0.01).
 * The first read after a bump scores every member again from its stored volume.
 */
const POINTS_VERSION = "2026-10-10";

async function rescoreLeaderboard() {
  if ((await getKey(key("points-version"))) === POINTS_VERSION) return;
  const ids = redisConfig()
    ? (((await run([["ZRANGE", key("points"), 0, -1]]))[0] as unknown[] | null) ?? []).filter((id): id is string => typeof id === "string")
    : [...memory.zset.keys()];
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100);
    if (!redisConfig()) {
      for (const id of batch) await setPoints(id, pointsOf(await getHash(id)));
      continue;
    }
    const hashes = (await run(batch.map((id) => ["HGETALL", key("p", id)]))).map(toHash);
    await run(
      batch.map((id, index): RedisCommand => {
        const points = pointsOf(hashes[index]);
        return points > 0 ? ["ZADD", key("points"), points, id] : ["ZREM", key("points"), id];
      }),
    );
  }
  await putKey(key("points-version"), POINTS_VERSION);
}

export async function readLeaderboard(limit = LEADERBOARD_SIZE): Promise<LeaderboardEntry[]> {
  await rescoreLeaderboard();
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

// ---------- referral payouts ----------

export interface Payable {
  id: string;
  username: string | null;
  earned: number;
  paid: number;
  claimable: number;
}

export interface Payout {
  id: string;
  /** The profile paid. */
  profile: string;
  usd: number;
  /** Transfer hash or a note, as the admin entered it. */
  reference: string;
  /** The admin who recorded it. */
  by: string;
  at: number;
}

/** Everyone with referral fees, most owed first (the admin payout list). */
export async function readPayables(): Promise<Payable[]> {
  const ids = await members(key("earners"));
  const rows = await Promise.all(
    ids.map(async (id) => {
      const hash = await getHash(id);
      const balance = referralBalance(hash);
      return { id, username: hash.username || null, earned: balance.referralEarnings, paid: balance.referralPaid, claimable: balance.referralClaimable };
    }),
  );
  return rows.sort((a, b) => b.claimable - a.claimable || b.earned - a.earned);
}

export async function readPayouts(id: string): Promise<Payout[]> {
  const hash: Record<string, string> = !redisConfig() ? { ...(memory.hashes.get(key("payouts", id)) ?? {}) } : toHash((await run([["HGETALL", key("payouts", id)]]))[0]);
  return Object.values(hash)
    .flatMap((value) => {
      try {
        return [JSON.parse(value) as Payout];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.at - a.at);
}

export type PayoutResult = { ok: true; payout: Payout; claimable: number } | { ok: false; error: string };

/** Records a referral payout an admin sent (never more than is claimable, a cent of rounding aside). */
export async function recordPayout(id: string, usd: number, reference: string, by: string, now = Date.now()): Promise<PayoutResult> {
  const amount = cents(usd);
  if (!(amount > 0)) return { ok: false, error: "Enter an amount above $0." };
  const { referralClaimable } = referralBalance(await getHash(id));
  if (amount > referralClaimable + 0.01) return { ok: false, error: `Only $${referralClaimable.toFixed(2)} is claimable.` };
  const payout: Payout = { id: `${now}-${randomInt(1e9)}`, profile: id, usd: amount, reference: reference.trim().slice(0, 200), by, at: now };
  if (redisConfig()) {
    await run([
      ["HINCRBYFLOAT", key("p", id), "refPaidUsd", amount],
      ["HSET", key("payouts", id), payout.id, JSON.stringify(payout)],
    ]);
  } else {
    await setFields(id, { refPaidUsd: String(Number((await getHash(id)).refPaidUsd ?? 0) + amount) });
    memory.hashes.set(key("payouts", id), { ...(memory.hashes.get(key("payouts", id)) ?? {}), [payout.id]: JSON.stringify(payout) });
  }
  return { ok: true, payout, claimable: referralBalance(await getHash(id)).referralClaimable };
}

// ---------- Discord roles (`lib/discord/*`) ----------

const DISCORD_STATE_SECONDS = 600;
const DISCORD_STATE = /^[A-Za-z0-9_-]{20,64}$/;
/** A role claim runs a few Discord calls: one per profile this often at most. */
const DISCORD_CLAIM_SECONDS = 20;

/** A one-time OAuth `state` tying Discord's answer to this profile (10 minutes). */
export async function createDiscordState(id: string) {
  const state = randomBytes(24).toString("base64url");
  await takeKey(key("dstate", state), DISCORD_STATE_SECONDS, id);
  return state;
}

/** The profile a `state` was made for, once (it's spent here). */
export async function takeDiscordState(state: string) {
  if (!DISCORD_STATE.test(state)) return null;
  const id = await getKey(key("dstate", state));
  if (id) await dropKey(key("dstate", state));
  return id;
}

export type DiscordLinkResult = { ok: true } | { ok: false; error: string };

/** Links a Discord account to a profile; one profile per Discord account (it must be unlinked from the other first). */
export async function linkDiscord(id: string, discordId: string, name: string): Promise<DiscordLinkResult> {
  const owner = await getKey(key("discord", discordId));
  if (owner && owner !== id) return { ok: false, error: "That Discord account is linked to another wallet. Unlink it there first." };
  const previous = (await getHash(id)).discordId;
  if (previous && previous !== discordId) await dropKey(key("discord", previous));
  await putKey(key("discord", discordId), id);
  await setFields(id, { discordId, discordName: name.slice(0, 64) });
  await deleteFields(id, ["discordRoles", "discordRetry"]);
  await addToSet(key("dlinked"), id);
  return { ok: true };
}

/** The Discord account linked to a profile, if any. */
export async function readDiscordLink(id: string) {
  const hash = await getHash(id);
  return hash.discordId ? { id: hash.discordId, name: hash.discordName || "Discord account" } : null;
}

/** Unlinks the profile's Discord account; answers its id (to take its roles back). */
export async function unlinkDiscord(id: string) {
  const link = await readDiscordLink(id);
  if (!link) return null;
  await dropKey(key("discord", link.id));
  await deleteFields(id, ["discordId", "discordName", "discordRoles", "discordRetry"]);
  if (redisConfig()) await run([["SREM", key("dlinked"), id]]);
  else memory.sets.get(key("dlinked"))?.delete(id);
  return link.id;
}

/**
 * Profiles with a linked Discord account (`dlinked` set). Links made before the set existed are added once, from the
 * `discord:<id>` index.
 */
export async function discordLinkedIds(): Promise<string[]> {
  if (!(await getKey(key("dlinked-v1")))) {
    if (redisConfig()) {
      let cursor = "0";
      const found: string[] = [];
      do {
        const [result] = await run([["SCAN", cursor, "MATCH", key("discord", "*"), "COUNT", 500]]);
        const [next, keys] = Array.isArray(result) ? (result as [string, string[]]) : ["0", []];
        cursor = String(next);
        if (keys.length) found.push(...((await run(keys.map((name) => ["GET", name]))) as unknown[]).filter((value): value is string => typeof value === "string"));
      } while (cursor !== "0");
      if (found.length) await run([["SADD", key("dlinked"), ...found]]);
    } else {
      for (const [name, entry] of memory.strings) if (name.startsWith(key("discord", ""))) await addToSet(key("dlinked"), entry.value);
    }
    await putKey(key("dlinked-v1"), "1");
  }
  return members(key("dlinked"));
}

/** What the automatic role refresh needs about a profile: its Discord account, level, 30-day volume and last sync. */
export async function readDiscordStanding(id: string) {
  const hash = await getHash(id);
  if (!hash.discordId) return null;
  const retry = Number(hash.discordRetry ?? 0);
  return {
    discordId: hash.discordId,
    level: levelFor(pointsOf(hash)).level,
    volume30d: await volume30d(id),
    roles: hash.discordRoles ?? null,
    retryAt: Number.isFinite(retry) ? retry : 0,
  };
}

/** Records the roles a profile's Discord account now holds (sorted ids), or when to try again after a failure. */
export async function saveDiscordSync(id: string, roles: string | null, retryAt = 0) {
  await setFields(id, { ...(roles !== null ? { discordRoles: roles } : {}), discordRetry: String(retryAt) });
}

/** True when the automatic role refresh may run now (once every 5 minutes across instances). */
export function takeDiscordAuto() {
  return takeKey(key("dauto"), 300);
}

/** True when this profile may claim roles now (DISCORD_CLAIM_SECONDS between claims). */
export function takeDiscordClaim(id: string) {
  return takeKey(key("dclaim", id), DISCORD_CLAIM_SECONDS);
}
