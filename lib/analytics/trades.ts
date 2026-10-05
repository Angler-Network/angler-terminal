/**
 * Trade counters for our own analytics. Events carry no personal data: no wallet address, no amounts, no IP.
 * Only which venue, which side, and which news item (if any) led to the trade.
 */
export interface TradeEvent {
  venue: "hyperliquid" | "lighter" | "jupiter";
  side: "buy" | "sell";
  /** Angler news id the trade came from, or null when placed from the panel directly. */
  newsId: string | null;
  oneClick: boolean;
}

const VENUES = new Set(["hyperliquid", "lighter", "jupiter"]);
const NEWS_ID = /^[A-Za-z0-9:_-]{1,100}$/;

export function readTradeEvent(value: unknown): TradeEvent | null {
  const record = (value ?? {}) as Record<string, unknown>;
  if (typeof record.venue !== "string" || !VENUES.has(record.venue)) return null;
  if (record.side !== "buy" && record.side !== "sell") return null;
  const newsId = typeof record.newsId === "string" && NEWS_ID.test(record.newsId) ? record.newsId : null;
  return { venue: record.venue as TradeEvent["venue"], side: record.side, newsId, oneClick: record.oneClick === true };
}

const MAX_TRACKED_NEWS = 500;

export interface TradeCounters {
  total: number;
  byVenue: Record<string, number>;
  fromNews: number;
  oneClick: number;
  byNews: Record<string, { total: number; byVenue: Record<string, number> }>;
  since: string;
}

export function createCounters(now = new Date()): TradeCounters {
  return { total: 0, byVenue: {}, fromNews: 0, oneClick: 0, byNews: {}, since: now.toISOString() };
}

/** Adds an event. Per-news counters keep the most recent MAX_TRACKED_NEWS items. */
export function countTrade(counters: TradeCounters, event: TradeEvent) {
  counters.total += 1;
  counters.byVenue[event.venue] = (counters.byVenue[event.venue] ?? 0) + 1;
  if (event.oneClick) counters.oneClick += 1;
  if (!event.newsId) return counters;
  counters.fromNews += 1;
  const entry = counters.byNews[event.newsId] ?? { total: 0, byVenue: {} };
  entry.total += 1;
  entry.byVenue[event.venue] = (entry.byVenue[event.venue] ?? 0) + 1;
  delete counters.byNews[event.newsId];
  counters.byNews[event.newsId] = entry;
  const ids = Object.keys(counters.byNews);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_TRACKED_NEWS))) delete counters.byNews[id];
  return counters;
}
