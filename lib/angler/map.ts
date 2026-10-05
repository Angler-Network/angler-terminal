import { normalizeDomain } from "@/lib/favicon";
import type { Direction, NewsItem, Severity } from "@/lib/types";
import type {
  ApiNewsItem,
  ApiNewsPage,
  ApiSource,
  FeedNews,
  FeedPage,
  ImpactPrediction,
  Sentiment,
  SourceNames,
} from "./types";

const SYMBOL_PATTERN = /^[A-Z0-9]{1,20}$/;
const PLACEHOLDER_SYMBOL = "NEWS";
const SENTIMENT_LABELS = new Set<Sentiment["label"]>(["positive", "negative", "neutral"]);

type Fields = Record<string, unknown>;

function fields(value: unknown): Fields | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Fields) : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integerId(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function score(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : undefined;
}

function unit(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}

function symbol(value: unknown) {
  const ticker = text(value)?.toUpperCase();
  return ticker && SYMBOL_PATTERN.test(ticker) ? ticker : undefined;
}

/** REST sends coins as tickers, the enriched stage as `{ symbol, relevance }`. */
function readCoins(value: unknown) {
  if (!Array.isArray(value)) return [];
  const symbols = value.flatMap((entry) => symbol(typeof entry === "string" ? entry : fields(entry)?.symbol) ?? []);
  return [...new Set(symbols)];
}

function readPredictions(value: unknown): ImpactPrediction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = fields(entry);
    const ticker = symbol(record?.symbol);
    const direction = record?.direction === "+" || record?.direction === "-" ? record.direction : undefined;
    const magnitude = score(record?.magnitude);
    return ticker && direction && magnitude !== undefined ? [{ symbol: ticker, direction, magnitude }] : [];
  });
}

function readSentiment(value: unknown): Sentiment | undefined {
  const record = fields(value);
  const label = record?.label as Sentiment["label"];
  const confidence = unit(record?.confidence);
  return SENTIMENT_LABELS.has(label) && confidence !== undefined ? { label, confidence } : undefined;
}

function timestamp(value: unknown) {
  const raw = text(value);
  return raw && Number.isFinite(Date.parse(raw)) ? raw : undefined;
}

function hostname(url: string | undefined) {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** Validates one `GET /v1/news` item. Drops `content`, which the terminal never shows and can be ~250 KB. */
export function readApiNewsItem(value: unknown): ApiNewsItem | null {
  const record = fields(value);
  const id = integerId(record?.id);
  const title = text(record?.title);
  const publishedAt = timestamp(record?.published_at);
  const importance = score(record?.importance_score);
  if (!record || !id || !title || !publishedAt || importance === undefined) return null;
  const coins = readCoins(record.coins);
  return {
    id,
    source_id: integerId(record.source_id) ?? 0,
    ...(text(record.external_id) ? { external_id: text(record.external_id) } : {}),
    ...(text(record.url) ? { url: text(record.url) } : {}),
    title,
    ...(text(record.lang) ? { lang: text(record.lang) } : {}),
    importance_score: importance,
    ...(coins.length ? { coins } : {}),
    published_at: publishedAt,
    ingested_at: timestamp(record.ingested_at) ?? publishedAt,
    ...(typeof record.is_unique === "boolean" ? { is_unique: record.is_unique } : {}),
  };
}

/** Validates a `GET /v1/news` page (`{ items, next_cursor }`). */
export function readApiNewsPage(value: unknown): ApiNewsPage {
  const record = fields(value);
  const items = Array.isArray(record?.items) ? record.items : [];
  return {
    items: items.flatMap((entry) => readApiNewsItem(entry) ?? []),
    next_cursor: text(record?.next_cursor) ?? null,
  };
}

export function fromApiNewsItem(item: ApiNewsItem): FeedNews {
  return {
    id: String(item.id),
    title: item.title,
    url: item.url,
    sourceId: item.source_id || undefined,
    lang: item.lang,
    publishedAt: item.published_at,
    importanceScore: item.importance_score,
    coins: item.coins ?? [],
    impactPredictions: [],
  };
}

/** Reads what /api/news returns (a validated `ApiNewsPage`). */
export function readNewsPage(value: unknown): FeedPage {
  const page = readApiNewsPage(value);
  return { items: page.items.map(fromApiNewsItem), nextCursor: page.next_cursor };
}

/**
 * Reads a realtime stage message, `{ news_item_id, item }`, from `news.raw` or `news.enriched`. The item's own
 * `id` is empty or missing, so the id comes from `news_item_id`. Raw items carry no score: that marks them as
 * not enriched yet.
 */
export function readStageMessage(value: unknown): FeedNews | null {
  const record = fields(value);
  const id = integerId(record?.news_item_id);
  const item = fields(record?.item);
  const title = text(item?.title);
  if (!id || !item || !title) return null;
  return {
    id: String(id),
    title,
    url: text(item.url),
    sourceSlug: text(item.source),
    lang: text(item.lang),
    publishedAt: timestamp(item.published_at),
    importanceScore: score(item.importance_score),
    coins: readCoins(item.coins),
    sentiment: readSentiment(item.sentiment),
    impactPredictions: readPredictions(item.impact_predictions),
    summaryShort: text(item.summary_short),
  };
}

/** Validates `GET /v1/sources` (`{ items }`), keeping the fields the terminal reads. */
export function readSources(value: unknown): ApiSource[] {
  const items = fields(value)?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((entry) => {
    const record = fields(entry);
    const id = integerId(record?.id);
    const slug = text(record?.external_id);
    if (!record || !id || !slug) return [];
    return [{ id, type: text(record.type) ?? "", external_id: slug, title: text(record.title), url: text(record.url) }];
  });
}

export function sourceNames(sources: ApiSource[]): SourceNames {
  const byId = new Map<number, string>();
  const bySlug = new Map<string, string>();
  for (const source of sources) {
    const name = source.title ?? source.external_id;
    byId.set(source.id, name);
    bySlug.set(source.external_id, name);
  }
  return { byId, bySlug };
}

/** Same thresholds angler-news uses for its built-in labels. */
export function severityFor(value: number): Severity {
  if (value >= 80) return "breaking";
  if (value >= 60) return "important";
  return "notable";
}

/** -1..1 for the angler-news components: the label's sign times its confidence. */
export function sentimentValue(sentiment: Sentiment | undefined) {
  if (!sentiment || sentiment.label === "neutral") return 0;
  return sentiment.label === "positive" ? sentiment.confidence : -sentiment.confidence;
}

function sourceName(news: FeedNews, names: SourceNames | undefined) {
  const named = (news.sourceId !== undefined ? names?.byId.get(news.sourceId) : undefined) ?? (news.sourceSlug ? names?.bySlug.get(news.sourceSlug) : undefined);
  return named ?? news.sourceSlug ?? hostname(news.url)?.replace(/^www\./, "");
}

/** Maps a feed item onto the NewsItem shape the angler-news components render. */
export function toNewsItem(news: FeedNews, now = Date.now(), names?: SourceNames): NewsItem {
  const predictions = [...news.impactPredictions].sort((a, b) => b.magnitude - a.magnitude);
  const lead = predictions[0];
  const sentiment = sentimentValue(news.sentiment);
  const value = Math.round(news.importanceScore ?? 0);
  const direction: Direction = lead ? (lead.direction === "+" ? "up" : "down") : sentiment < 0 ? "down" : "up";
  const coins = [...new Set([...predictions.map((prediction) => prediction.symbol), ...news.coins])];
  const parsed = news.publishedAt ? Date.parse(news.publishedAt) : Number.NaN;
  const publishedAt = Number.isFinite(parsed) ? parsed : now;
  const source = sourceName(news, names);

  return {
    id: news.id,
    severity: severityFor(value),
    headline: news.title,
    symbol: coins[0] ?? PLACEHOLDER_SYMBOL,
    direction,
    score: value,
    sentiment,
    sources: source ? [source] : [],
    categories: [],
    minutesAgo: Math.max(0, Math.floor((now - publishedAt) / 60_000)),
    publishedAt,
    url: news.url,
    sourceDomain: normalizeDomain(hostname(news.url)) ?? normalizeDomain(news.sourceSlug) ?? undefined,
    summary: news.summaryShort,
    coins,
    predictions,
    enriched: news.importanceScore !== undefined,
    hasSentiment: news.sentiment !== undefined,
  };
}

/**
 * Upsert for raw → enriched. Enrichment only overwrites when the newer payload has it, so a late raw duplicate
 * never wipes an item that was already enriched.
 */
export function mergeFeedNews(previous: FeedNews | undefined, next: FeedNews): FeedNews {
  if (!previous) return next;
  return {
    id: next.id,
    title: next.title || previous.title,
    url: next.url ?? previous.url,
    sourceId: next.sourceId ?? previous.sourceId,
    sourceSlug: next.sourceSlug ?? previous.sourceSlug,
    lang: next.lang ?? previous.lang,
    publishedAt: previous.publishedAt ?? next.publishedAt,
    importanceScore: next.importanceScore ?? previous.importanceScore,
    coins: next.coins.length ? next.coins : previous.coins,
    sentiment: next.sentiment ?? previous.sentiment,
    impactPredictions: next.impactPredictions.length ? next.impactPredictions : previous.impactPredictions,
    summaryShort: next.summaryShort ?? previous.summaryShort,
  };
}
