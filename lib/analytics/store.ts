import "server-only";
import { countTrade, createCounters, type TradeEvent } from "./trades";

/**
 * In-memory counters per server instance, plus one structured log line per event so the hosting provider's logs
 * keep the full history. Swap this for a database when counters must survive restarts.
 */
const globalForCounters = globalThis as unknown as { __anglerTradeCounters?: ReturnType<typeof createCounters> };
const counters = (globalForCounters.__anglerTradeCounters ??= createCounters());

export function recordTrade(event: TradeEvent) {
  countTrade(counters, event);
  console.info(JSON.stringify({ event: "trade_placed", ...event, at: new Date().toISOString() }));
}

export function readCounters() {
  return counters;
}
