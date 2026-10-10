import "server-only";
import { mapLimit } from "@/lib/async";
import { venueAvailable } from "@/lib/deployment";
import { lighterConfig, lighterRhConfig, type LighterConfig } from "@/lib/venues/lighter/config";
import { refreshDiscordRoles } from "@/lib/discord/auto";
import { leaderEvents, type LeaderEvent, type LeaderPosition } from "@/lib/copy/events";
import { followId, type WatchedWallet } from "@/lib/copy/follows";
import { leaderMessage } from "@/lib/copy/messages";
import { siteUrl } from "@/lib/site";
import { deliver } from "./channels";
import { alertPrices } from "./coins";
import {
  liquidationMessages,
  newsMessages,
  positionKey,
  positionMessages,
  priceMessages,
  type AlertNews,
  type AlertState,
  type AlertVenue,
  type PositionSnap,
} from "./rules";
import { hasChannel, type AlertSettings } from "./settings";
import { alertCoins, hlPositions, latestNews, lighterAccountIndex, lighterPositions } from "./sources";
import { readAll, readLeaders, readNewsCursor, releaseTickLock, saveLeaders, saveNewsCursor, saveStates, takeTickLock, type LeaderState } from "./store";

/**
 * One pass over every profile with an alert channel, run once a minute by a scheduler calling /api/alerts/tick:
 * shared reads first (mids, news), then each profile's positions, then one post per channel with what changed.
 */

const CONCURRENCY = 6;
/** How often an address without a Lighter account is looked up again. */
const LIGHTER_LOOKUP_MS = 60 * 60_000;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;

const LIGHTER_CONFIGS: LighterConfig[] = [
  ...(venueAvailable("lighter") ? [lighterConfig] : []),
  ...(venueAvailable("lighterRh") ? [lighterRhConfig] : []),
];

/**
 * Current positions by key. A venue that can't be read keeps its last known positions, so a timeout never reads as
 * "closed" (and the reopen after it as "opened").
 */
async function readPositions(address: string, state: AlertState, now: number) {
  const previous = Object.values(state.positions ?? {});
  const accounts = { ...state.lighterAccounts };
  const reads: Array<{ venue: AlertVenue; load: () => Promise<PositionSnap[]> }> = [{ venue: "hyperliquid", load: () => hlPositions(address) }];
  for (const config of LIGHTER_CONFIGS) {
    const venue = config.venue as AlertVenue;
    reads.push({
      venue,
      load: async () => {
        let account = accounts[venue];
        if (!account || (account.index === null && now - account.at > LIGHTER_LOOKUP_MS)) {
          account = { index: await lighterAccountIndex(config, address), at: now };
          accounts[venue] = account;
        }
        return account.index === null ? [] : lighterPositions(config, account.index);
      },
    });
  }
  const settled = await Promise.allSettled(reads.map((read) => read.load()));
  const current: Record<string, PositionSnap> = {};
  settled.forEach((result, index) => {
    const venue = reads[index].venue;
    const positions = result.status === "fulfilled" ? result.value : previous.filter((position) => position.venue === venue);
    for (const position of positions) current[positionKey(position)] = position;
  });
  return { current, lighterAccounts: accounts };
}

/** Followed wallets read per tick at most; beyond this the venues' per-IP limits would start refusing reads. */
const MAX_LEADERS = 300;

const toLeaderPositions = (positions: PositionSnap[]) =>
  Object.fromEntries(positions.map((position) => [position.coin, { coin: position.coin, size: position.size, entryPx: position.entryPx, markPx: position.markPx } satisfies LeaderPosition]));

/**
 * Every followed wallet once, however many profiles follow it: its events since the last tick (none on the first look,
 * or when its venue couldn't be read) and its new state.
 */
async function readLeaderEvents(wallets: WatchedWallet[], now: number) {
  const keys = [...new Set(wallets.map((wallet) => followId(wallet.source, wallet.address)))].slice(0, MAX_LEADERS);
  const byKey = new Map(wallets.map((wallet) => [followId(wallet.source, wallet.address), wallet]));
  const states = await readLeaders(keys);
  const events: Record<string, LeaderEvent[]> = {};
  const next: Record<string, LeaderState> = {};
  await mapLimit(keys, CONCURRENCY, async (key) => {
    const wallet = byKey.get(key)!;
    const state = states[key] ?? { positions: null };
    try {
      let account = state.account;
      let positions: PositionSnap[];
      if (wallet.source === "hyperliquid") positions = await hlPositions(wallet.address);
      else {
        const config = wallet.source === "lighter" ? lighterConfig : lighterRhConfig;
        if (!account || (account.index === null && now - account.at > LIGHTER_LOOKUP_MS)) account = { index: await lighterAccountIndex(config, wallet.address), at: now };
        positions = account.index === null ? [] : await lighterPositions(config, account.index);
      }
      const current = toLeaderPositions(positions);
      if (state.positions) events[key] = leaderEvents(state.positions, current);
      next[key] = { positions: current, account };
    } catch {
      // Unreadable this minute: keep the last positions, so a timeout never reads as every position closing.
    }
  });
  return { events, next };
}

function wantsPositions(settings: AlertSettings) {
  return settings.positions || settings.liquidationPct !== null || (settings.newsMinImpact !== null && settings.newsHeld);
}

async function runProfile(
  id: string,
  settings: AlertSettings,
  state: AlertState,
  mids: Record<string, number>,
  news: AlertNews[],
  now: number,
  leaders: Record<string, LeaderEvent[]>,
) {
  const messages: string[] = [];
  const site = siteUrl();
  for (const wallet of settings.follows) {
    for (const event of leaders[followId(wallet.source, wallet.address)] ?? []) messages.push(leaderMessage(event, wallet, site));
  }
  let next: AlertState = state;

  if (EVM_ADDRESS.test(id) && wantsPositions(settings)) {
    const { current, lighterAccounts } = await readPositions(id, state, now);
    // The first look only records what's open: nothing "opened" just because alerts were turned on.
    if (settings.positions && state.positions) messages.push(...positionMessages(state.positions, current));
    const liquidation = liquidationMessages(current, settings.liquidationPct, state.liqWarned);
    messages.push(...liquidation.messages);
    next = { ...next, positions: current, liqWarned: liquidation.warned, lighterAccounts };
  }

  const prices = priceMessages(settings.prices, mids, state.firedPrices);
  messages.push(...prices.messages);
  next = { ...next, firedPrices: prices.fired };

  const held = Object.values(next.positions ?? {}).map((position) => position.coin);
  messages.push(...newsMessages(news, settings, held));

  if (messages.length > 0) await deliver(settings, messages);
  return { state: next, sent: messages.length, changed: JSON.stringify(next) !== JSON.stringify(state) };
}

export async function runAlertsTick(now = Date.now()) {
  if (!(await takeTickLock())) return { skipped: true as const };
  try {
    const profiles = (await readAll()).filter((profile) => hasChannel(profile.settings));
    const armed = profiles.some((profile) => profile.settings.prices.some((alert) => !profile.state.firedPrices.includes(alert.id)));
    const impacts = profiles.flatMap((profile) => (profile.settings.newsMinImpact === null ? [] : [profile.settings.newsMinImpact]));

    const followed = profiles.flatMap((profile) => profile.settings.follows);
    const [mids, items, cursor, leaders] = await Promise.all([
      armed ? alertCoins().then(alertPrices).catch(() => ({})) : Promise.resolve({}),
      impacts.length > 0 ? latestNews(Math.min(...impacts)).catch(() => []) : Promise.resolve([]),
      readNewsCursor(),
      readLeaderEvents(followed, now),
    ]);
    // News newer than the last tick saw; the first tick only sets the cursor (no backlog of old headlines).
    const newest = Math.max(cursor, ...items.map((item) => item.id));
    const news = cursor > 0 ? items.filter((item) => item.id > cursor) : [];

    const results = await mapLimit(profiles, CONCURRENCY, async (profile) => {
      try {
        return { id: profile.id, ...(await runProfile(profile.id, profile.settings, profile.state, mids, news, now, leaders.events)) };
      } catch (error) {
        console.error("alerts: profile failed", profile.id, error);
        return { id: profile.id, state: profile.state, sent: 0, changed: false };
      }
    });

    await saveStates(results.filter((result) => result.changed).map(({ id, state }) => ({ id, state })));
    await saveLeaders(leaders.next);
    if (newest > cursor) await saveNewsCursor(newest);
    // Discord level and VIP roles follow the profiles on their own (every 5 minutes, only changed ones call Discord).
    await refreshDiscordRoles(now).catch((error) => console.error("discord: role refresh failed", error));
    return { skipped: false as const, profiles: profiles.length, messages: results.reduce((sum, result) => sum + result.sent, 0), news: news.length, leaders: Object.keys(leaders.next).length };
  } finally {
    await releaseTickLock();
  }
}
