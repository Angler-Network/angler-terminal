import "server-only";
import { privateKeyToAccount } from "viem/accounts";
import { asterConfig } from "@/lib/venues/aster/config";
import { signAgentRequest } from "@/lib/venues/aster/sign";

/**
 * A wallet's Aster volume through Angler, from Aster's own record of our builder's users (`GET /fapi/v3/builder/
 * userTrades`, signed by an agent of the builder account: ASTER_BUILDER_AGENT_KEY). Only trades that carried our
 * builder code are there, so the browser can't inflate it. Aster keeps 90 days.
 */

const TIMEOUT_MS = 10_000;
const PAGE = 1000;
const MAX_PAGES = 5;
const MAX_LOOKBACK_MS = 89 * 86_400_000;

export interface AsterBuilderTrade {
  tradeId?: number;
  insertTime?: number;
  totalQuota?: string;
  builderFee?: string;
  userAddress?: string;
}

/** Volume (quote value) and our fee in a page of builder trades, the part placed during the closed beta, and the newest trade time. */
export function asterAnglerVolume(rows: AsterBuilderTrade[], user: string, inBeta: (time: number) => boolean = () => false) {
  let usd = 0;
  let betaUsd = 0;
  let fee = 0;
  let lastTime = 0;
  for (const row of rows) {
    if (row.userAddress && row.userAddress.toLowerCase() !== user.toLowerCase()) continue;
    const time = Number(row.insertTime) || 0;
    const amount = Math.abs(Number(row.totalQuota) || 0);
    lastTime = Math.max(lastTime, time);
    usd += amount;
    if (inBeta(time)) betaUsd += amount;
    fee += Math.abs(Number(row.builderFee) || 0);
  }
  return { usd, betaUsd, fee, lastTime };
}

export function asterSyncEnabled(env: Record<string, string | undefined> = process.env) {
  return Boolean(asterConfig.builder && /^0x[0-9a-fA-F]{64}$/.test(env.ASTER_BUILDER_AGENT_KEY?.trim() ?? ""));
}

export async function syncAster(user: string, cursor: number | null, inBeta: (time: number) => boolean = () => false) {
  const builder = asterConfig.builder;
  const key = process.env.ASTER_BUILDER_AGENT_KEY?.trim();
  if (!builder || !key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  const agent = privateKeyToAccount(key as `0x${string}`);
  const start = Math.max(cursor === null ? 0 : cursor + 1, Date.now() - MAX_LOOKBACK_MS);
  let usd = 0;
  let betaUsd = 0;
  let fee = 0;
  let last = cursor ?? 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const query = await signAgentRequest(agent, builder.address, { userAddresses: user, startTime: start, page, limit: PAGE });
    const response = await fetch(`${asterConfig.apiUrl}/fapi/v3/builder/userTrades?${query}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Aster answered ${response.status}`);
    const body = (await response.json()) as { rows?: AsterBuilderTrade[]; hasMore?: boolean };
    const batch = asterAnglerVolume(body.rows ?? [], user, inBeta);
    usd += batch.usd;
    betaUsd += batch.betaUsd;
    fee += batch.fee;
    last = Math.max(last, batch.lastTime);
    if (!body.hasMore) break;
  }
  return { usd, betaUsd, fee, cursor: last };
}
