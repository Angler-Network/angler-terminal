/**
 * Angler News API payloads (https://api.angler.network, spec at /openapi.yaml), checked against live responses.
 *
 * News reaches the terminal in two shapes:
 * - REST (`GET /v1/news`): a stored row, `ApiNewsItem`. It carries `importance_score` and `coins` but no
 *   sentiment, predictions or summary.
 * - Realtime stage messages (`news.raw`, then `news.enriched` for the same `news_item_id`): `{ news_item_id, item }`.
 *   The raw item has no id and no score; the enriched item has `id: ""`, so the id always comes from
 *   `news_item_id`. Sources are a slug there (`source`) and a numeric `source_id` on REST, both resolved
 *   through `GET /v1/sources`.
 *
 * The API carries no Solana mints. ./map.ts turns both shapes into `FeedNews`.
 */

/** RFC 3339 UTC, 0-9 fraction digits: "2026-10-05T15:10:53Z", "2026-10-05T15:16:24.683295617Z". */
export type ApiTimestamp = string;

/** One item of `GET /v1/news` (spec `NewsItem`). */
export interface ApiNewsItem {
  id: number;
  source_id: number;
  /** Upstream id (tweet id, Tree of Alpha id); only on some sources. */
  external_id?: string;
  url?: string;
  title: string;
  /** Article body, often HTML and up to ~250 KB. /api/news drops it. */
  content?: string;
  /** ISO 639-1, sometimes with a region ("en-US"); absent when unknown. */
  lang?: string;
  /** Integer 0-100. */
  importance_score: number;
  /** Uppercase tickers; absent when none were found. */
  coins?: string[];
  published_at: ApiTimestamp;
  ingested_at: ApiTimestamp;
  is_unique?: boolean;
}

export interface ApiNewsPage {
  items: ApiNewsItem[];
  /** base64url keyset cursor; null on the last page. Pass back as `cursor`. */
  next_cursor: string | null;
}

/** `GET /v1/sources` item (the fields the terminal reads). */
export interface ApiSource {
  id: number;
  /** "web" | "twitter" | "telegram" | "treealpha" | "domain" | ... */
  type: string;
  /** Slug; the realtime `item.source` names a source by it. */
  external_id: string;
  title?: string;
  url?: string;
}

export type ImpactDirection = "+" | "-";

/** Predicted move of one coin. There is no confidence on it. */
export interface ImpactPrediction {
  symbol: string;
  direction: ImpactDirection;
  /** Integer 0-100. */
  magnitude: number;
}

export interface Sentiment {
  label: "positive" | "negative" | "neutral";
  /** 0-1 */
  confidence: number;
  per_coin?: unknown[];
}

export interface CoinMention {
  symbol: string;
  /** 0-1 */
  relevance: number;
}

export interface Entity {
  type: "coin" | "equity" | "company" | "person" | "country" | "institution";
  name: string;
  symbol: string | null;
  canonical_id: string | null;
  role: string | null;
  /** 0-1 */
  confidence: number;
  impact: { direction: ImpactDirection | "0"; magnitude: number; confidence: number } | null;
}

export interface ExposureItem {
  id: string;
  kind: string;
  name: string;
  proxy?: string | null;
  direction: ImpactDirection;
  relevance: number;
  confidence: number;
  p_up: number;
  p_down: number;
  p_flat: number;
  mentioned?: boolean;
}

/** Realtime `news.raw` message. */
export interface RawStageMessage {
  news_item_id: number;
  ingested_at: ApiTimestamp;
  item: {
    url?: string;
    title: string;
    content?: string;
    lang?: string;
    /** Source slug (`ApiSource.external_id`). */
    source: string;
    published_at: ApiTimestamp;
  };
}

/** Realtime `news.enriched` message. Fields can be missing when the plan masks them. */
export interface EnrichedStageMessage {
  news_item_id: number;
  item: {
    /** Always "": use `news_item_id`. */
    id: string;
    source: string;
    url?: string;
    title: string;
    content?: string;
    lang?: string;
    published_at: ApiTimestamp;
    sentiment?: Sentiment;
    importance_score: number;
    coins?: CoinMention[];
    persons?: { name: string; role: string | null }[];
    countries?: { code: string; role: string | null }[];
    impact_predictions?: ImpactPrediction[];
    entities?: Entity[];
    summary_short?: string;
    ai_comment?: string;
    title_en?: string | null;
    decisions?: {
      event_type?: { label: string; confidence: number };
      urgency?: number;
      rumor?: number;
      promotional?: number;
      source?: string;
      provider?: string;
      model?: string;
    };
    exposures?: { model?: string; provider?: string; sectors?: ExposureItem[]; assets?: ExposureItem[] };
  };
}

/** What the terminal keeps per news id after reading any of the shapes above. */
export interface FeedNews {
  id: string;
  title: string;
  url?: string;
  /** REST items name their source by id, realtime items by slug. */
  sourceId?: number;
  sourceSlug?: string;
  lang?: string;
  publishedAt?: ApiTimestamp;
  /** Absent on raw realtime items, which are not scored yet. */
  importanceScore?: number;
  coins: string[];
  sentiment?: Sentiment;
  impactPredictions: ImpactPrediction[];
  summaryShort?: string;
}

export interface FeedPage {
  items: FeedNews[];
  nextCursor: string | null;
}

/** Source title by numeric id and by slug, from `/api/sources`. */
export interface SourceNames {
  byId: Map<number, string>;
  bySlug: Map<string, string>;
}

/** `POST /v1/ws/ticket`. The ticket is an EdDSA token for one connection; `expires_in` is in seconds (300). */
export interface WsTicket {
  ticket: string;
  expires_in: number;
  channels: string[];
}

/** What /api/ws-ticket returns to the browser: the API ticket plus the socket URL to use it on. */
export interface WsTicketResponse extends WsTicket {
  url: string;
}

export const NEWS_CHANNELS = ["news.raw", "news.enriched"] as const;

export type NewsChannel = (typeof NEWS_CHANNELS)[number];
