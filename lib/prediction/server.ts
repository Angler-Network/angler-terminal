import "server-only";
import { unstable_cache } from "next/cache";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import { buildHip4Events, type Hip4Meta } from "./hip4";
import { mapGammaEvent, type GammaEvent } from "./polymarket";
import { readBook, readHistory, type PredictionBook, type PredictionRange, type PricePoint } from "./market-data";
import { readPolymarketTrades, type PredictionTrade } from "./trades";
import type { PredictionEvent, PredictionSource } from "./types";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const TIMEOUT_MS = 10_000;
/** Events listed per source: Polymarket's busiest by 24h volume (HIP-4 lists every live outcome, a few hundred). */
const POLYMARKET_EVENTS = 150;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return (await response.json()) as T;
}

function hlInfo<T>(body: unknown) {
  return json<T>(`${hlConfig.apiUrl}/info`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const mapEvents = (list: GammaEvent[]) => list.map(mapGammaEvent).filter((event): event is PredictionEvent => event !== null);

/** Polymarket's open events by 24h volume, two pages of Gamma. */
export const getPolymarketEvents = unstable_cache(
  async (): Promise<PredictionEvent[]> => {
    const page = (offset: number) =>
      json<GammaEvent[]>(`${GAMMA}/events?active=true&closed=false&order=volume24hr&ascending=false&limit=${POLYMARKET_EVENTS / 2}&offset=${offset}`);
    const [first, second] = await Promise.all([page(0), page(POLYMARKET_EVENTS / 2)]);
    const seen = new Set<string>();
    return mapEvents([...first, ...second]).filter((event) => !seen.has(event.id) && seen.add(event.id));
  },
  ["prediction-polymarket-v2"],
  { revalidate: 60 },
);

/** Polymarket's own search, open events only. */
export const searchPolymarket = unstable_cache(
  async (query: string): Promise<PredictionEvent[]> => {
    const body = await json<{ events?: GammaEvent[] }>(`${GAMMA}/public-search?${new URLSearchParams({ q: query, limit_per_type: "20", events_status: "active" })}`);
    return mapEvents(body.events ?? []);
  },
  ["prediction-polymarket-search-v2"],
  { revalidate: 60 },
);

export const getPolymarketEvent = unstable_cache(
  async (id: string): Promise<PredictionEvent | null> => mapGammaEvent(await json<GammaEvent>(`${GAMMA}/events/${encodeURIComponent(id)}`)),
  ["prediction-polymarket-event-v2"],
  { revalidate: 30 },
);

const getHip4Meta = unstable_cache(async () => hlInfo<Hip4Meta>({ type: "outcomeMeta" }), [`prediction-hip4-meta-${hlConfig.network}`], { revalidate: 60 });

/** Every live HIP-4 outcome as events, with prices from `allMids` (outcome coins start with `#`). */
export const getHip4Events = unstable_cache(
  async (): Promise<PredictionEvent[]> => {
    const [meta, mids] = await Promise.all([getHip4Meta(), hlInfo<Record<string, string>>({ type: "allMids" })]);
    return buildHip4Events(meta, mids);
  },
  [`prediction-hip4-events-v2-${hlConfig.network}`],
  { revalidate: 10 },
);

export async function getPredictionEvents(source: PredictionSource | "all") {
  const wanted: PredictionSource[] = source === "all" ? ["polymarket", "hyperliquid"] : [source];
  const results = await Promise.allSettled(wanted.map((name) => (name === "polymarket" ? getPolymarketEvents() : getHip4Events())));
  const failed: PredictionSource[] = [];
  const events = results.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value;
    console.warn(`[prediction] ${wanted[index]} list failed: ${String(result.reason)}`);
    failed.push(wanted[index]);
    return [];
  });
  return { events, failed };
}

export async function getPredictionEvent(id: string): Promise<PredictionEvent | null> {
  if (id.startsWith("pm:")) return getPolymarketEvent(id.slice(3));
  if (id.startsWith("hl:")) return (await getHip4Events()).find((event) => event.id === id) ?? null;
  return null;
}

/** HIP-4 candles per range: enough points for a smooth line without paging. */
const HL_CANDLES: Record<PredictionRange, { interval: string; span: number }> = {
  "1d": { interval: "15m", span: 86_400_000 },
  "1w": { interval: "1h", span: 7 * 86_400_000 },
  "1m": { interval: "4h", span: 30 * 86_400_000 },
  all: { interval: "1d", span: 365 * 86_400_000 },
};

export const getPriceHistory = unstable_cache(
  async (source: PredictionSource, asset: string, range: PredictionRange): Promise<PricePoint[]> => {
    if (source === "polymarket") {
      const interval = range === "all" ? "max" : range;
      const fidelity = range === "1d" ? 5 : range === "1w" ? 60 : range === "1m" ? 240 : 1440;
      return readHistory("polymarket", await json(`${CLOB}/prices-history?${new URLSearchParams({ market: asset, interval, fidelity: String(fidelity) })}`));
    }
    const { interval, span } = HL_CANDLES[range];
    const now = Date.now();
    return readHistory("hyperliquid", await hlInfo({ type: "candleSnapshot", req: { coin: asset, interval, startTime: now - span, endTime: now } }));
  },
  ["prediction-history-v1"],
  { revalidate: 60 },
);

export async function getPredictionBook(source: PredictionSource, asset: string): Promise<PredictionBook> {
  if (source === "polymarket") return readBook("polymarket", await json(`${CLOB}/book?token_id=${encodeURIComponent(asset)}`));
  return readBook("hyperliquid", await hlInfo({ type: "l2Book", coin: asset }));
}

/** A Polymarket market slug (what trades carry) → its event's id here (`pm:<event id>`); null when Gamma has none. */
export const resolvePolymarketSlug = unstable_cache(
  async (slug: string): Promise<string | null> => {
    const market = await json<{ events?: Array<{ id?: unknown }> }>(`${GAMMA}/markets/slug/${encodeURIComponent(slug)}`);
    const id = market.events?.[0]?.id;
    return typeof id === "string" || typeof id === "number" ? `pm:${id}` : null;
  },
  ["prediction-polymarket-slug-v1"],
  { revalidate: 3600 },
);

const DATA_API = "https://data-api.polymarket.com";
const TRADES_LIMIT = 60;

/** Polymarket's latest taker trades of at least `minUsd`, across every market (shared by every viewer for 3s). */
export const getRecentTrades = unstable_cache(
  async (minUsd: number): Promise<PredictionTrade[]> =>
    readPolymarketTrades(
      await json<unknown>(`${DATA_API}/trades?${new URLSearchParams({ limit: String(TRADES_LIMIT), takerOnly: "true", filterType: "CASH", filterAmount: String(minUsd) })}`),
    ),
  ["prediction-trades-v1"],
  { revalidate: 3 },
);
