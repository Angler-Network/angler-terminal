import type { ImpactPrediction } from "@/lib/angler/types";

export type Severity = "breaking" | "important" | "notable";

export type Direction = "up" | "down";

export type AssetKind = "crypto" | "stock";

export interface Asset {
  name: string;
  kind: AssetKind;
  color: string;
  glyph: string;
}

export interface NewsItem {
  id: string;
  severity: Severity;
  headline: string;
  symbol: string;
  direction: Direction;
  score: number;
  sentiment: number;
  sources: string[];
  categories: string[];
  minutesAgo: number;
  alerted?: boolean;
  marketReaction?: boolean;
  // Terminal additions from the Angler News API; optional so angler-news components keep working unchanged.
  publishedAt?: number;
  url?: string;
  /** Publisher domain (from the article URL, or a domain-like source name), used for its favicon. */
  sourceDomain?: string;
  summary?: string;
  /** Every asset the news touches, strongest predicted impact first. */
  coins?: string[];
  predictions?: ImpactPrediction[];
  /** Solana mints by symbol, when the API provides them. */
  mints?: Record<string, string>;
  /** False while only the raw item has arrived. */
  enriched?: boolean;
}
