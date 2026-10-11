import "server-only";
import { extendedConfig } from "@/lib/venues/extended/config";

/**
 * A profile's Extended volume through Angler, from Extended's own record of our builder's trades (`GET /api/v1/builder/
 * trades`, read with our builder account's API key: EXTENDED_BUILDER_API_KEY, server only). Each row shows only the side
 * our builder code was on, with that side's account id (`takerId` / `makerId`: the docs' example has the same trade as
 * account 3017 in `/user/trades` and as `makerId` 3017 here). A profile counts the trades of the Extended accounts linked
 * to it (`linkExtendedAccount`, proved with the account's own API key), so the browser can't inflate it.
 */

const TIMEOUT_MS = 10_000;
const PAGE = 1000;
const MAX_PAGES = 10;
const MAX_LOOKBACK_MS = 90 * 86_400_000;
/** One shared read of the builder's trades per instance a minute, whatever the number of profiles syncing. */
const SHARED_MS = 60_000;

export interface ExtendedBuilderTrade {
  time?: number;
  volume?: string;
  takerId?: number | null;
  takerBuilderId?: number | null;
  takerBuilderFee?: string | null;
  makerId?: number | null;
  makerBuilderId?: number | null;
  makerBuilderFee?: string | null;
}

/** A page's rows and its next cursor. Trade ids pass 2^53, so the cursor is read from the raw text, never as a number. */
export function readBuilderPage(text: string): { rows: ExtendedBuilderTrade[]; cursor: string | null } {
  const body = JSON.parse(text) as { status?: string; data?: unknown };
  if (body.status !== "OK" || !Array.isArray(body.data)) throw new Error("Extended sent no builder trades");
  const cursor = /"pagination"\s*:\s*\{[^}]*"cursor"\s*:\s*"?(\d+)"?/.exec(text)?.[1] ?? null;
  return { rows: body.data as ExtendedBuilderTrade[], cursor };
}

/** Volume (USD) and our builder fee of the linked accounts' trades after `since` (ms), the part placed during the closed beta, and the newest trade time. */
export function extendedAnglerVolume(rows: ExtendedBuilderTrade[], accounts: number[], builderId: number, since: number, inBeta: (time: number) => boolean = () => false) {
  const linked = new Set(accounts);
  let usd = 0;
  let betaUsd = 0;
  let fee = 0;
  let lastTime = since;
  for (const row of rows) {
    const time = Number(row.time) || 0;
    if (time <= since) continue;
    const side =
      row.takerId != null && linked.has(Number(row.takerId)) && Number(row.takerBuilderId) === builderId
        ? row.takerBuilderFee
        : row.makerId != null && linked.has(Number(row.makerId)) && Number(row.makerBuilderId) === builderId
          ? row.makerBuilderFee
          : undefined;
    if (side === undefined) continue;
    const amount = Math.abs(Number(row.volume) || 0);
    usd += amount;
    if (inBeta(time)) betaUsd += amount;
    fee += Math.abs(Number(side) || 0);
    lastTime = Math.max(lastTime, time);
  }
  return { usd, betaUsd, fee, lastTime };
}

function builderKey(env: Record<string, string | undefined> = process.env) {
  const key = env.EXTENDED_BUILDER_API_KEY?.trim();
  return key && /^[A-Za-z0-9_-]{8,200}$/.test(key) ? key : null;
}

export function extendedSyncEnabled(env: Record<string, string | undefined> = process.env) {
  return Boolean(extendedConfig.builderId && builderKey(env));
}

let shared: { at: number; rows: Promise<ExtendedBuilderTrade[]> } | null = null;

/** Our builder's trades of the last 90 days (newest first, up to 10,000), read once a minute per instance. */
function builderTrades(): Promise<ExtendedBuilderTrade[]> {
  if (shared && Date.now() - shared.at < SHARED_MS) return shared.rows;
  const key = builderKey()!;
  const rows = (async () => {
    const all: ExtendedBuilderTrade[] = [];
    let cursor: string | null = null;
    const oldest = Date.now() - MAX_LOOKBACK_MS;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ limit: String(PAGE) });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`${extendedConfig.host}/api/v1/builder/trades?${query}`, {
        headers: { "x-api-key": key, "user-agent": "AnglerTerminal/1.0", accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Extended answered ${response.status}`);
      const next = readBuilderPage(await response.text());
      all.push(...next.rows);
      const last = Number(next.rows.at(-1)?.time) || 0;
      if (next.rows.length < PAGE || !next.cursor || last < oldest) break;
      cursor = next.cursor;
    }
    return all;
  })();
  shared = { at: Date.now(), rows };
  rows.catch(() => {
    if (shared?.rows === rows) shared = null;
  });
  return rows;
}

export async function syncExtended(accounts: number[], cursor: number | null, inBeta: (time: number) => boolean = () => false) {
  const builderId = extendedConfig.builderId;
  if (!builderId || !extendedSyncEnabled() || accounts.length === 0) return null;
  const volume = extendedAnglerVolume(await builderTrades(), accounts, builderId, cursor ?? 0, inBeta);
  return { usd: volume.usd, betaUsd: volume.betaUsd, fee: volume.fee, cursor: volume.lastTime };
}

/** The account id behind a user's Extended API key (`/api/v1/user/account/info`); the key is used for this read only. */
export async function extendedAccountOf(apiKey: string): Promise<number | null> {
  const response = await fetch(`${extendedConfig.host}/api/v1/user/account/info`, {
    headers: { "x-api-key": apiKey, "user-agent": "AnglerTerminal/1.0", accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error(`Extended answered ${response.status}`);
  const body = (await response.json()) as { status?: string; data?: { accountId?: unknown } };
  const id = Number(body.data?.accountId);
  return body.status === "OK" && Number.isSafeInteger(id) && id > 0 ? id : null;
}
