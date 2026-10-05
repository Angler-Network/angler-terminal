import type { NewsItem, Severity } from "@/lib/types";

export type Sentiment = "bullish" | "neutral" | "bearish";

export const sentiments: Sentiment[] = ["bullish", "neutral", "bearish"];
export const severities: Severity[] = ["breaking", "important", "notable"];

/** Sentiment within ±this reads as neutral (same cut the news card's pill uses). */
export const NEUTRAL_SENTIMENT = 0.15;

export function sentimentOf(score: number): Sentiment {
  if (score >= NEUTRAL_SENTIMENT) return "bullish";
  if (score <= -NEUTRAL_SENTIMENT) return "bearish";
  return "neutral";
}

export interface NewsFilters {
  /** Only news that mentions one of these symbols; empty means every asset. */
  assets: string[];
  sentiments: Sentiment[];
  severities: Severity[];
  minImpact: number;
  /** Raw items have no score, sentiment or assets yet; show them unless an asset filter or focus is active. */
  showRaw: boolean;
}

export const defaultNewsFilters: NewsFilters = {
  assets: [],
  sentiments: [...sentiments],
  severities: [...severities],
  minImpact: 0,
  showRaw: true,
};

/** How many filters differ from the defaults (for the badge on the feed's filter button). */
export function countActiveFilters(filters: NewsFilters) {
  return (
    (filters.assets.length > 0 ? 1 : 0) +
    (filters.sentiments.length < sentiments.length ? 1 : 0) +
    (filters.severities.length < severities.length ? 1 : 0) +
    (filters.minImpact > 0 ? 1 : 0) +
    (filters.showRaw ? 0 : 1)
  );
}

/**
 * Applies the saved filters plus an optional one-off focus (a symbol picked from the ticker tape). Raw items only pass
 * when raw headlines are shown and no asset restriction applies, since their assets aren't known yet.
 */
export function filterNews<T extends Pick<NewsItem, "enriched" | "coins" | "sentiment" | "severity" | "score">>(
  items: T[],
  filters: NewsFilters,
  focus?: string | null,
) {
  const assets = new Set(filters.assets.map((asset) => asset.toUpperCase()));
  const focusSymbol = focus?.toUpperCase();
  return items.filter((item) => {
    if (!item.enriched) return filters.showRaw && assets.size === 0 && !focusSymbol;
    const coins = item.coins ?? [];
    if (focusSymbol && !coins.includes(focusSymbol)) return false;
    if (assets.size > 0 && !coins.some((coin) => assets.has(coin))) return false;
    if (item.score < filters.minImpact) return false;
    if (!filters.severities.includes(item.severity)) return false;
    return filters.sentiments.includes(sentimentOf(item.sentiment));
  });
}
