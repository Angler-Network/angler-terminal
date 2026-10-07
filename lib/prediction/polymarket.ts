import type { PredictionCategory, PredictionEvent, PredictionMarket } from "./types";

/**
 * Polymarket events from the Gamma API (`/events`), mapped to the shared shape. Gamma sends outcomes, prices and
 * token ids as JSON strings inside the JSON; Protocol V2 markets trade by `positionIds`, older (CTF) markets by
 * `clobTokenIds`. Closed or inactive markets are dropped; multi-outcome events list the likeliest first.
 */

export const POLYMARKET_URL = "https://polymarket.com";

interface GammaMarket {
  id: string;
  question?: string;
  conditionId?: string;
  groupItemTitle?: string;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  positionIds?: string;
  version?: string;
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean;
  orderPriceMinTickSize?: number;
  orderMinSize?: number;
  negRisk?: boolean;
  volume24hr?: number;
  oneDayPriceChange?: number;
}

export interface GammaEvent {
  id: string;
  slug?: string;
  title?: string;
  image?: string;
  icon?: string;
  endDate?: string;
  volume24hr?: number;
  volume?: number | string;
  negRisk?: boolean;
  closed?: boolean;
  tags?: Array<{ label?: string; slug?: string }>;
  markets?: GammaMarket[];
}

function list(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

function number(value: unknown) {
  const parsed = Number(value);
  return value !== undefined && value !== null && value !== "" && Number.isFinite(parsed) ? parsed : null;
}

const CATEGORY_TAGS: Array<[PredictionCategory, RegExp]> = [
  ["crypto", /^(crypto|bitcoin|ethereum|solana|crypto-prices|xrp|memecoins?)$/],
  ["economy", /^(economy|fed|fomc|fed-rates|inflation|macro-indicators|economic-policy|finance|global-rates|recession)$/i],
  ["sports", /^(sports|esports|soccer|nfl|nba|mlb|nhl|tennis|golf|ufc|f1|cricket|games|football|basketball)$/],
  ["politics", /^(politics|elections|us-election|world-elections|geopolitics|world|trump)$/],
  ["stocks", /^(stocks|earnings|equities|indices|commodities)$/],
  ["companies", /^(tech|ai|business|companies|ipos?|big-tech)$/],
  ["culture", /^(pop-culture|culture|movies|music|awards|celebrities|tweets-markets|mentions)$/],
];

/** The first tag that names a category wins, in the order the categories are listed above. */
export function categoryOf(tags: GammaEvent["tags"]): PredictionCategory {
  const slugs = (tags ?? []).map((tag) => (tag.slug ?? tag.label ?? "").toLowerCase());
  for (const [category, pattern] of CATEGORY_TAGS) if (slugs.some((slug) => pattern.test(slug))) return category;
  return "other";
}

function mapMarket(market: GammaMarket, eventTitle: string, single: boolean): PredictionMarket | null {
  if (market.closed || market.active === false) return null;
  const names = list(market.outcomes);
  const prices = list(market.outcomePrices)?.map(number);
  const assets = market.version === "v2" ? (list(market.positionIds) ?? list(market.clobTokenIds)) : (list(market.clobTokenIds) ?? list(market.positionIds));
  if (!names || names.length !== 2 || !assets || assets.length !== 2) return null;
  return {
    id: `pm:${market.id}`,
    label: single ? eventTitle : (market.groupItemTitle?.trim() || market.question || eventTitle),
    question: market.question ?? null,
    outcomes: [
      { label: names[0], price: prices?.[0] ?? null, asset: assets[0] },
      { label: names[1], price: prices?.[1] ?? null, asset: assets[1] },
    ],
    acceptingOrders: market.acceptingOrders !== false,
    tickSize: number(market.orderPriceMinTickSize) ?? 0.01,
    minSize: number(market.orderMinSize) ?? 5,
    volume24h: number(market.volume24hr),
    change24h: number(market.oneDayPriceChange),
    polymarket: { conditionId: market.conditionId ?? "", negRisk: Boolean(market.negRisk), version: market.version ?? "v1" },
  };
}

export function mapGammaEvent(event: GammaEvent): PredictionEvent | null {
  if (event.closed) return null;
  const title = event.title?.trim() || "Untitled";
  const raw = event.markets ?? [];
  const markets = raw.map((market) => mapMarket(market, title, raw.length === 1)).filter((market): market is PredictionMarket => market !== null);
  // One-winner (neg risk) events list the likeliest first; independent markets (price strikes, game lines) keep
  // Polymarket's order.
  if (event.negRisk) markets.sort((a, b) => (b.outcomes[0].price ?? 0) - (a.outcomes[0].price ?? 0));
  if (markets.length === 0) return null;
  const endsAt = event.endDate ? Date.parse(event.endDate) : Number.NaN;
  return {
    id: `pm:${event.id}`,
    source: "polymarket",
    title,
    subtitle: null,
    image: event.icon || event.image || null,
    category: categoryOf(event.tags),
    endsAt: Number.isFinite(endsAt) ? endsAt : null,
    volume24h: number(event.volume24hr),
    volume: number(event.volume),
    url: event.slug ? `${POLYMARKET_URL}/event/${event.slug}` : null,
    exclusive: Boolean(event.negRisk),
    markets,
  };
}
