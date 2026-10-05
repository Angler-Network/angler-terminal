/**
 * Angler News API payloads (https://api.angler.network).
 *
 * The same news object comes from three places: GET /v1/news, the `news.raw` channel and the
 * `news.enriched` channel. Raw items arrive first and carry no enrichment; the enriched item for the
 * same `id` arrives later. Fields not listed in the spec are optional, and readers in ./map.ts accept
 * a few alternative names so a schema tweak doesn't blank the feed.
 */

export type ImpactDirection = "+" | "-";

export interface ImpactPrediction {
  symbol: string;
  direction: ImpactDirection;
  /** 0-100 */
  magnitude: number;
  /** 0-1 (some payloads send 0-100; normalized in map.ts) */
  confidence: number;
}

export interface ApiNews {
  id: string;
  headline?: string;
  title?: string;
  url?: string;
  source?: string;
  sources?: string[];
  published_at?: string | number;
  created_at?: string | number;
  categories?: string[];
  // Enrichment (present on news.enriched and on enriched history items)
  coins?: string[];
  /** -1..1 */
  sentiment?: number;
  impact_predictions?: ImpactPrediction[];
  summary_short?: string;
  /** 0-100 */
  importance_score?: number;
}

export interface NewsPage {
  items: ApiNews[];
  next_cursor: string | null;
}

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
