/**
 * Trade analytics, anonymous by design: events carry no wallet address and no IP, and the store keeps only daily
 * totals (trades, USD volume, estimated partner fees per venue), never a per-trade record.
 */
export const TRADE_VENUES = ["hyperliquid", "lighter", "lighterRh", "jupiter", "titan", "arcus", "uniswap", "relay", "lifi", "polymarket"] as const;
export type TradeVenue = (typeof TRADE_VENUES)[number];

export interface TradeEvent {
  venue: TradeVenue;
  side: "buy" | "sell";
  /** Angler news id the trade came from, or null when placed from the panel directly. */
  newsId: string | null;
  oneClick: boolean;
  /** Executed notional in USD (0 for limit orders that rest instead of filling). */
  usd: number;
  /** Our fee on this trade in bps, when the browser knows it (perps); spot fees come from server config. */
  feeBps: number | null;
}

/** Larger single trades are treated as bogus. */
export const MAX_TRADE_USD = 10_000_000;
const MAX_FEE_BPS = 300;
const NEWS_ID = /^[A-Za-z0-9:_-]{1,100}$/;

function readNumber(value: unknown, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}

export function readTradeEvent(value: unknown): TradeEvent | null {
  const record = (value ?? {}) as Record<string, unknown>;
  if (typeof record.venue !== "string" || !(TRADE_VENUES as readonly string[]).includes(record.venue)) return null;
  if (record.side !== "buy" && record.side !== "sell") return null;
  // Tabs opened before amounts were sent post no `usd`: counted as a trade without volume.
  const usd = record.usd === undefined ? 0 : readNumber(record.usd, MAX_TRADE_USD);
  if (usd === null) return null;
  const newsId = typeof record.newsId === "string" && NEWS_ID.test(record.newsId) ? record.newsId : null;
  return {
    venue: record.venue as TradeVenue,
    side: record.side,
    newsId,
    oneClick: record.oneClick === true,
    usd: Math.round(usd * 100) / 100,
    feeBps: readNumber(record.feeBps, MAX_FEE_BPS),
  };
}

/** Partner fee rates set on the server, in bps. */
export interface ServerFeeRates {
  jupiterBps: number;
  titanBps: number;
  arcusBps: number;
  uniswapBps: number;
  relayBps: number;
  lifiBps: number;
}

/** Jupiter keeps 20% of the referral fee. */
const JUPITER_FEE_SHARE = 0.8;

export function readServerFeeRates(env: Record<string, string | undefined>): ServerFeeRates {
  const bps = (value: string | undefined, enabled: boolean) => {
    const number = Number(value);
    return enabled && Number.isFinite(number) && number > 0 ? number : 0;
  };
  return {
    jupiterBps: bps(env.JUP_REFERRAL_FEE_BPS, Boolean(env.JUP_REFERRAL_ACCOUNT?.trim())),
    titanBps: bps(env.TITAN_FEE_BPS, Boolean(env.TITAN_FEE_WALLET?.trim())),
    arcusBps: bps(env.ARCUS_BUILDER_FEE_BPS, Boolean(env.ARCUS_API_KEY?.trim())),
    uniswapBps: bps(env.UNISWAP_FEE_BPS, Boolean(env.UNISWAP_API_KEY?.trim() && env.UNISWAP_FEE_RECIPIENT?.trim())),
    relayBps: bps(env.RELAY_FEE_BPS, Boolean(env.RELAY_FEE_RECIPIENT?.trim())),
    // LI.FI may keep a share of integrator fees; this is the full rate.
    lifiBps: bps(env.LIFI_FEE_BPS, Boolean(env.LIFI_INTEGRATOR?.trim())),
  };
}

/** Our estimated revenue from one trade in USD: the rate the browser reported for perps, server config for spot. */
export function estimateFeeUsd(event: TradeEvent, rates: ServerFeeRates) {
  const bps =
    event.venue === "jupiter"
      ? rates.jupiterBps * JUPITER_FEE_SHARE
      : event.venue === "titan"
        ? rates.titanBps
        : event.venue === "arcus"
          ? rates.arcusBps
          : event.venue === "uniswap"
            ? rates.uniswapBps
            : event.venue === "relay"
              ? rates.relayBps
              : event.venue === "lifi"
                ? rates.lifiBps
                : (event.feeBps ?? 0);
  return Math.round(event.usd * bps * 100) / 1_000_000;
}

/** Counter fields one trade adds to its day and to the all-time totals. */
export function tradeIncrements(event: TradeEvent, feeUsd: number): Array<[field: string, amount: number]> {
  const fields: Array<[string, number]> = [
    ["trades", 1],
    ["usd", event.usd],
    ["fee", feeUsd],
    [`trades:${event.venue}`, 1],
    [`usd:${event.venue}`, event.usd],
    [`fee:${event.venue}`, feeUsd],
  ];
  if (event.newsId) fields.push(["news:trades", 1], ["news:usd", event.usd]);
  if (event.oneClick) fields.push(["oneclick:trades", 1]);
  return fields.filter(([, amount]) => amount !== 0);
}

export interface VenueTotals {
  trades: number;
  usd: number;
  fee: number;
}

export interface StatsTotals extends VenueTotals {
  byVenue: Partial<Record<TradeVenue, VenueTotals>>;
  newsTrades: number;
  newsUsd: number;
  oneClickTrades: number;
}

/** Turns a stored counter hash (field → number, or its string form from Redis) into totals. */
export function readTotals(hash: Record<string, string | number> | null | undefined): StatsTotals {
  const value = (field: string) => {
    const number = Number(hash?.[field] ?? 0);
    return Number.isFinite(number) ? number : 0;
  };
  const byVenue: StatsTotals["byVenue"] = {};
  for (const venue of TRADE_VENUES) {
    const trades = value(`trades:${venue}`);
    if (trades > 0) byVenue[venue] = { trades, usd: roundUsd(value(`usd:${venue}`)), fee: roundUsd(value(`fee:${venue}`)) };
  }
  return {
    trades: value("trades"),
    usd: roundUsd(value("usd")),
    fee: roundUsd(value("fee")),
    byVenue,
    newsTrades: value("news:trades"),
    newsUsd: roundUsd(value("news:usd")),
    oneClickTrades: value("oneclick:trades"),
  };
}

/** Adds day totals together (for 7- and 30-day windows). */
export function sumTotals(days: StatsTotals[]): StatsTotals {
  const hash: Record<string, number> = {};
  const add = (field: string, amount: number) => (hash[field] = (hash[field] ?? 0) + amount);
  for (const day of days) {
    add("trades", day.trades);
    add("usd", day.usd);
    add("fee", day.fee);
    add("news:trades", day.newsTrades);
    add("news:usd", day.newsUsd);
    add("oneclick:trades", day.oneClickTrades);
    for (const [venue, totals] of Object.entries(day.byVenue)) {
      add(`trades:${venue}`, totals.trades);
      add(`usd:${venue}`, totals.usd);
      add(`fee:${venue}`, totals.fee);
    }
  }
  return readTotals(hash);
}

function roundUsd(value: number) {
  return Math.round(value * 100) / 100;
}

/** UTC day key, e.g. 2026-10-06. */
export function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** The last `count` UTC days ending with `now`'s, oldest first. */
export function lastDays(now: Date, count: number) {
  return Array.from({ length: count }, (_, index) => dayKey(new Date(now.getTime() - (count - 1 - index) * 86_400_000)));
}

/** Volume a perp order actually filled, in USD (0 when it rests on the book). */
export function filledUsd(result: { status: "filled"; filledSize: number; avgPx: number } | { status: "resting" }) {
  return result.status === "filled" ? Math.abs(result.filledSize * result.avgPx) : 0;
}
