import "server-only";
import { orderlyConfig } from "@/lib/venues/orderly/config";

/**
 * A wallet's Orderly volume through Angler, from Orderly's public broker leaderboard (`GET /v1/broker/leaderboard/
 * daily?broker_id=&address=`): one row per day with the account's perp volume and the broker fee it paid us. Only
 * accounts registered under our broker are there, so the browser can't inflate it. Days are counted once they've
 * closed (UTC), so points trail Orderly by up to a day; the cursor is the last counted day's midnight.
 */

const TIMEOUT_MS = 10_000;
const PAGE = 500;
const MAX_PAGES = 5;
const DAY_MS = 86_400_000;
const MAX_LOOKBACK_DAYS = 89;

export interface OrderlyBrokerDay {
  date?: string;
  perp_volume?: number | string;
  broker_fee?: number | string;
  address?: string;
  broker_id?: string;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Volume and our fee in closed days after `cursor` (a day's midnight in ms), and the newest day counted. */
export function orderlyAnglerVolume(rows: OrderlyBrokerDay[], user: string, broker: string, cursor: number | null, now = Date.now()) {
  const today = Date.parse(isoDay(now));
  let usd = 0;
  let fee = 0;
  let last = cursor ?? 0;
  for (const row of rows) {
    if (row.address?.toLowerCase() !== user.toLowerCase() || row.broker_id !== broker) continue;
    const day = Date.parse(row.date ?? "");
    if (!Number.isFinite(day) || day >= today || (cursor !== null && day <= cursor)) continue;
    usd += Math.abs(Number(row.perp_volume) || 0);
    fee += Math.abs(Number(row.broker_fee) || 0);
    last = Math.max(last, day);
  }
  return { usd, fee, lastDay: last };
}

export async function syncOrderly(user: string, cursor: number | null, now = Date.now()) {
  const broker = orderlyConfig.brokerId;
  if (!broker || !orderlyConfig.ownBroker) return null;
  const today = Date.parse(isoDay(now));
  const start = Math.max(cursor === null ? 0 : cursor + DAY_MS, today - MAX_LOOKBACK_DAYS * DAY_MS);
  const end = today - DAY_MS;
  if (start > end) return null;
  const rows: OrderlyBrokerDay[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const query = new URLSearchParams({ broker_id: broker, address: user, start_date: isoDay(start), end_date: isoDay(end), page: String(page), size: String(PAGE) });
    const response = await fetch(`${orderlyConfig.apiUrl}/v1/broker/leaderboard/daily?${query}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Orderly answered ${response.status}`);
    const body = (await response.json()) as { success?: boolean; message?: string; data?: { rows?: OrderlyBrokerDay[] } };
    if (!body.success) throw new Error(`Orderly: ${body.message ?? "request refused"}`);
    const batch = body.data?.rows ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  const result = orderlyAnglerVolume(rows, user, broker, cursor, now);
  // Nothing traded in the window still moves the cursor to yesterday, so the next sync asks only for new days.
  return { usd: result.usd, fee: result.fee, cursor: Math.max(result.lastDay, end) };
}
