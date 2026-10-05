import type { Direction, NewsItem, Severity } from "@/lib/types";
import type { ApiNews, ImpactPrediction, NewsPage } from "./types";

const SYMBOL_PATTERN = /^[A-Za-z0-9]{1,20}$/;
const PLACEHOLDER_SYMBOL = "NEWS";

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberIn(value: unknown, min: number, max: number) {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : undefined;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

/** Coins sometimes arrive with a quote or venue attached ("BTCUSDT", "xyz:NVDA"); keep the bare ticker. */
function toSymbol(value: unknown) {
  const raw = text(value)?.toUpperCase().replace(/^[A-Z]+:/, "").replace(/[-/]?(USDT|USDC|USD|PERP)$/, "");
  return raw && SYMBOL_PATTERN.test(raw) ? raw : undefined;
}

function toTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string" && value) {
    const parsed: number | undefined = /^\d+$/.test(value) ? toTimestamp(Number(value)) : Date.parse(value);
    return parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readPredictions(value: unknown): ImpactPrediction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const symbol = toSymbol(record.symbol);
    const direction = record.direction === "+" || record.direction === "-" ? record.direction : undefined;
    if (!symbol || !direction) return [];
    const confidence = numberIn(record.confidence, 0, 100) ?? 0;
    return [
      {
        symbol,
        direction,
        magnitude: numberIn(record.magnitude, 0, 100) ?? 0,
        confidence: confidence > 1 ? confidence / 100 : confidence,
      },
    ];
  });
}

const MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Solana mints by symbol. The payload shape isn't specified, so accept a `mints` map, a `tokens` array of
 * { symbol, mint }, or a `mint` on impact predictions.
 */
function readMints(record: Record<string, unknown>) {
  const mints: Record<string, string> = {};
  const add = (symbol: unknown, mint: unknown) => {
    const clean = toSymbol(symbol);
    if (clean && typeof mint === "string" && MINT_PATTERN.test(mint)) mints[clean] = mint;
  };
  if (record.mints && typeof record.mints === "object" && !Array.isArray(record.mints)) {
    for (const [symbol, mint] of Object.entries(record.mints as Record<string, unknown>)) add(symbol, mint);
  }
  for (const list of [record.tokens, record.impact_predictions]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const item = (entry ?? {}) as Record<string, unknown>;
      add(item.symbol, item.mint ?? item.address);
    }
  }
  return Object.keys(mints).length > 0 ? mints : undefined;
}

/** Validates one news object from REST or the socket. Returns null when it has no id or headline. */
export function readApiNews(value: unknown): ApiNews | null {
  const record = (value ?? {}) as Record<string, unknown>;
  const id = record.id ?? record.news_id;
  const headline = text(record.headline) ?? text(record.title);
  if ((typeof id !== "string" && typeof id !== "number") || !headline) return null;
  const source = text(record.source);
  return {
    id: String(id),
    headline,
    url: text(record.url) ?? text(record.link),
    source,
    sources: strings(record.sources),
    published_at: (record.published_at ?? record.created_at ?? record.timestamp ?? record.time) as string | number | undefined,
    categories: strings(record.categories),
    coins: strings(record.coins).flatMap((coin) => toSymbol(coin) ?? []),
    sentiment: numberIn(record.sentiment, -1, 1),
    impact_predictions: readPredictions(record.impact_predictions),
    summary_short: text(record.summary_short),
    importance_score: numberIn(record.importance_score ?? record.importance, 0, 100),
    mints: readMints(record),
  };
}

export function readNewsPage(value: unknown): NewsPage {
  const record = (value ?? {}) as Record<string, unknown>;
  const list = Array.isArray(value) ? value : Array.isArray(record.items) ? record.items : Array.isArray(record.data) ? record.data : [];
  const cursor = record.next_cursor;
  return {
    items: list.flatMap((entry) => readApiNews(entry) ?? []),
    next_cursor: typeof cursor === "string" && cursor ? cursor : typeof cursor === "number" ? String(cursor) : null,
  };
}

/** Same thresholds angler-news uses for its built-in labels. */
export function severityFor(score: number): Severity {
  if (score >= 80) return "breaking";
  if (score >= 60) return "important";
  return "notable";
}

function isEnriched(news: ApiNews) {
  return news.importance_score !== undefined || (news.impact_predictions?.length ?? 0) > 0 || news.summary_short !== undefined;
}

/** Strongest call first: magnitude weighted by confidence. */
function rankPredictions(predictions: ImpactPrediction[]) {
  return [...predictions].sort((a, b) => b.magnitude * b.confidence - a.magnitude * a.confidence);
}

/** Maps an API news object onto the NewsItem shape the angler-news components render. */
export function toNewsItem(news: ApiNews, now = Date.now()): NewsItem {
  const predictions = rankPredictions(news.impact_predictions ?? []);
  const lead = predictions[0];
  const sentiment = news.sentiment ?? 0;
  const score = Math.round(news.importance_score ?? 0);
  const direction: Direction = lead ? (lead.direction === "+" ? "up" : "down") : sentiment < 0 ? "down" : "up";
  const coins = [...new Set([...predictions.map((prediction) => prediction.symbol), ...(news.coins ?? [])])];
  const publishedAt = toTimestamp(news.published_at) ?? now;
  const sources = [...new Set([news.source, ...(news.sources ?? [])].filter((source): source is string => Boolean(source)))];

  return {
    id: news.id,
    severity: severityFor(score),
    headline: news.headline ?? news.title ?? "",
    symbol: coins[0] ?? PLACEHOLDER_SYMBOL,
    direction,
    score,
    sentiment,
    sources,
    categories: news.categories ?? [],
    minutesAgo: Math.max(0, Math.floor((now - publishedAt) / 60_000)),
    publishedAt,
    url: news.url,
    summary: news.summary_short,
    coins,
    predictions,
    mints: news.mints,
    enriched: isEnriched(news),
  };
}

/**
 * Upsert for raw → enriched. Enrichment fields only overwrite when the newer payload has them, so a late raw
 * duplicate never wipes an item that was already enriched.
 */
export function mergeApiNews(previous: ApiNews | undefined, next: ApiNews): ApiNews {
  if (!previous) return next;
  const pick = <K extends keyof ApiNews>(key: K) => (next[key] !== undefined ? next[key] : previous[key]);
  const pickList = <K extends "coins" | "impact_predictions" | "categories" | "sources">(key: K) =>
    (next[key]?.length ? next[key] : previous[key]) as ApiNews[K];
  return {
    ...previous,
    ...next,
    headline: next.headline ?? previous.headline,
    url: pick("url"),
    source: pick("source"),
    published_at: previous.published_at ?? next.published_at,
    sentiment: pick("sentiment"),
    summary_short: pick("summary_short"),
    mints: next.mints ? { ...previous.mints, ...next.mints } : previous.mints,
    importance_score: pick("importance_score"),
    coins: pickList("coins"),
    impact_predictions: pickList("impact_predictions"),
    categories: pickList("categories"),
    sources: pickList("sources"),
  };
}
