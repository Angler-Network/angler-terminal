/**
 * Prediction markets from two sources, in one shape: Polymarket (the deep, global book; data read through our
 * server) and Hyperliquid HIP-4 outcome markets (traded with the terminal's Hyperliquid account).
 */
export type PredictionSource = "polymarket" | "hyperliquid";

export type PredictionCategory = "politics" | "crypto" | "economy" | "sports" | "stocks" | "companies" | "culture" | "other";

export const PREDICTION_CATEGORIES: Array<{ id: PredictionCategory; label: string }> = [
  { id: "politics", label: "Politics" },
  { id: "crypto", label: "Crypto" },
  { id: "economy", label: "Economy" },
  { id: "sports", label: "Sports" },
  { id: "stocks", label: "Stocks" },
  { id: "companies", label: "Companies" },
  { id: "culture", label: "Culture" },
  { id: "other", label: "Other" },
];

/** One side of a market: what it's called, its price (= implied probability, 0-1) and the asset traded for it. */
export interface PredictionOutcome {
  label: string;
  /** Last mid or price, 0-1; null when the book has none. */
  price: number | null;
  /** Polymarket: the CLOB token or position id. Hyperliquid: the `#N` coin. */
  asset: string;
}

/** A binary market: two outcomes (Yes/No, or two teams) that pay $1 to the winner. */
export interface PredictionMarket {
  id: string;
  /** Short name inside its event ("Gavin Newsom", "≥ $90,000"); the event title alone when it has one market. */
  label: string;
  /** Full question, when the source gives one. */
  question: string | null;
  outcomes: [PredictionOutcome, PredictionOutcome];
  acceptingOrders: boolean;
  /** Price step and minimum order, in the source's units (Polymarket: shares; Hyperliquid: whole contracts). */
  tickSize: number;
  minSize: number;
  volume24h: number | null;
  /** Change of the first outcome's price over 24h, in probability points (0.05 = +5 pts). */
  change24h: number | null;
  /** Polymarket only: trading details the SDK needs. */
  polymarket?: { conditionId: string; negRisk: boolean; version: string };
}

export interface PredictionEvent {
  /** `pm:<event id>` or `hl:<key>`. */
  id: string;
  source: PredictionSource;
  title: string;
  /** Competition, deadline or other context under the title. */
  subtitle: string | null;
  image: string | null;
  category: PredictionCategory;
  /** When trading ends or the question resolves (ms), when known. */
  endsAt: number | null;
  volume24h: number | null;
  volume: number | null;
  /** Polymarket's event page (Hyperliquid has none). */
  url: string | null;
  /** Exactly one market resolves Yes (a winner among candidates); otherwise the markets are independent lines. */
  exclusive: boolean;
  markets: PredictionMarket[];
}

/** Probability as a whole-number percentage, "<1%" and ">99%" at the edges. */
export function formatChance(price: number | null) {
  if (price === null || !Number.isFinite(price)) return "—";
  const percent = price * 100;
  if (percent > 0 && percent < 1) return "<1%";
  if (percent < 100 && percent > 99) return ">99%";
  return `${Math.round(percent)}%`;
}
