/**
 * Order-book spot markets on the perp venues the terminal already trades: Hyperliquid spot (HYPE, UBTC, PURR…) and
 * Lighter spot (ETH, LIT, LINK…), both against USDC, on testnet and mainnet. A picked market rides in the selected
 * asset's `mint` slot as `book:<venue>:<id>` (Hyperliquid: the pair index, Lighter: the market id), like EVM tokens
 * (`evm:<chain>:<address>`). Pure, unit-tested.
 */

import { assetSymbolOf, type SpotCategory, type SpotListing } from "./listings";

export type BookSpotVenue = "hyperliquid" | "lighter";

export const BOOK_SPOT_VENUE_NAMES: Record<BookSpotVenue, string> = { hyperliquid: "Hyperliquid", lighter: "Lighter" };

export interface BookSpotMarket {
  venue: BookSpotVenue;
  /** Hyperliquid pair index, Lighter market id. */
  id: number;
  /** Hyperliquid's coin name for the pair ("@107", "PURR/USDC"); Lighter's symbol ("ETH/USDC"). */
  coin: string;
  /** Base token as the venue names it ("UBTC", "ETH"). */
  base: string;
  /** The terminal asset it trades as ("UBTC" → "BTC"). */
  asset: string;
  name: string;
  quote: "USDC";
  /** Order asset id: Hyperliquid 10000 + pair index, Lighter the market id. */
  assetId: number;
  /** Size step: 10^-szDecimals (Hyperliquid: the base token's szDecimals; Lighter: size_decimals). */
  szDecimals: number;
  /** Lighter: prices are integers scaled by 10^priceDecimals. */
  priceDecimals?: number;
  /** Hyperliquid: the base token's index (its `spotClearinghouseState` balance). Lighter: the base asset id. */
  baseToken: number;
  /** Lighter: the quote (USDC) asset id. */
  quoteToken?: number;
  minBaseAmount?: number;
  minQuoteAmount?: number;
  takerFee?: number;
  category: SpotCategory;
  price?: number;
  change24h?: number;
  volume24h?: number;
}

/** Smallest order either venue takes, in USD (Hyperliquid: $10 notional; Lighter: the market's min quote). */
export const HL_SPOT_MIN_ORDER_USD = 10;

/** Spot pairs with less 24h volume are hidden: testnet has over a thousand junk pairs, mainnet hundreds of dead ones. */
export const HL_SPOT_MIN_VOLUME_USD: Record<"mainnet" | "testnet", number> = { mainnet: 1_000, testnet: 10 };

const finite = (value: unknown) => {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
};

export function bookSpotRef(venue: BookSpotVenue, id: number) {
  return `book:${venue}:${id}`;
}

/** Hyperliquid's coin name for a spot pair: "PURR/USDC" for the first pair, "@<index>" for the rest. */
export function hlSpotCoin(index: number) {
  return index === 0 ? "PURR/USDC" : `@${index}`;
}

export function isBookSpotRef(value: string | null | undefined): value is string {
  return typeof value === "string" && parseBookSpotRef(value) !== null;
}

export function parseBookSpotRef(value: string | null | undefined): { venue: BookSpotVenue; id: number } | null {
  const match = typeof value === "string" ? /^book:(hyperliquid|lighter):(\d{1,7})$/.exec(value) : null;
  return match ? { venue: match[1] as BookSpotVenue, id: Number(match[2]) } : null;
}

/**
 * Unit's bridged tokens are named after the asset with a U in front ("UBTC", full name "Unit Bitcoin"); they trade as
 * the asset. Everything else trades as its own ticker.
 */
export function hlSpotAsset(name: string, fullName?: string | null) {
  if (/^U[A-Z0-9]{2,}$/.test(name) && /^unit\b/i.test(fullName ?? "")) return name.slice(1);
  return name;
}

interface HlSpotToken {
  name?: unknown;
  index?: unknown;
  szDecimals?: unknown;
  fullName?: unknown;
}

interface HlSpotPair {
  name?: unknown;
  index?: unknown;
  tokens?: unknown;
  isCanonical?: unknown;
}

interface HlSpotCtx {
  coin?: unknown;
  midPx?: unknown;
  markPx?: unknown;
  prevDayPx?: unknown;
  dayNtlVlm?: unknown;
}

/**
 * Hyperliquid `spotMetaAndAssetCtxs` → USDC pairs with at least `minVolume` of 24h volume and a price. Contexts are
 * matched by coin name and tokens by their `index` field: neither list is aligned by position.
 */
export function readHlSpotMarkets(body: unknown, minVolume: number): BookSpotMarket[] {
  if (!Array.isArray(body) || body.length < 2) return [];
  const meta = body[0] as { tokens?: unknown; universe?: unknown } | null;
  const tokens = new Map<number, HlSpotToken>();
  for (const token of Array.isArray(meta?.tokens) ? (meta.tokens as HlSpotToken[]) : []) {
    if (typeof token?.index === "number") tokens.set(token.index, token);
  }
  const contexts = new Map<string, HlSpotCtx>();
  for (const context of Array.isArray(body[1]) ? (body[1] as HlSpotCtx[]) : []) {
    if (typeof context?.coin === "string") contexts.set(context.coin, context);
  }
  const markets: BookSpotMarket[] = [];
  for (const pair of Array.isArray(meta?.universe) ? (meta.universe as HlSpotPair[]) : []) {
    if (typeof pair?.name !== "string" || typeof pair.index !== "number" || !Array.isArray(pair.tokens)) continue;
    const base = tokens.get(pair.tokens[0] as number);
    const quote = tokens.get(pair.tokens[1] as number);
    if (!base || quote?.name !== "USDC" || typeof base.name !== "string" || typeof base.szDecimals !== "number") continue;
    const context = contexts.get(pair.name);
    const price = finite(context?.midPx) ?? finite(context?.markPx);
    const volume = finite(context?.dayNtlVlm) ?? 0;
    if (!price || !(price > 0) || volume < minVolume) continue;
    const previous = finite(context?.prevDayPx);
    const fullName = typeof base.fullName === "string" ? base.fullName : null;
    markets.push({
      venue: "hyperliquid",
      id: pair.index,
      coin: pair.name,
      base: base.name,
      asset: hlSpotAsset(base.name, fullName),
      name: fullName || base.name,
      quote: "USDC",
      assetId: 10_000 + pair.index,
      szDecimals: base.szDecimals,
      baseToken: base.index as number,
      category: "crypto",
      price,
      change24h: previous && previous > 0 ? ((price - previous) / previous) * 100 : undefined,
      volume24h: volume,
    });
  }
  return markets.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
}

interface LighterSpotDetail {
  symbol?: unknown;
  market_id?: unknown;
  market_type?: unknown;
  base_asset_id?: unknown;
  quote_asset_id?: unknown;
  status?: unknown;
  taker_fee?: unknown;
  min_base_amount?: unknown;
  min_quote_amount?: unknown;
  size_decimals?: unknown;
  price_decimals?: unknown;
  last_trade_price?: unknown;
  daily_price_change?: unknown;
  daily_quote_token_volume?: unknown;
}

/** Lighter's tokenized index funds ("rhSPY") and gold (XAUT) aren't crypto. */
function lighterCategory(base: string): SpotCategory {
  if (/^rh[A-Z]/.test(base)) return "index";
  if (/^(XAUT|PAXG|XAG)$/i.test(base)) return "commodity";
  return "crypto";
}

/** Lighter `orderBookDetails` → its active USDC spot markets (`spot_order_book_details`). */
export function readLighterSpotMarkets(body: unknown): BookSpotMarket[] {
  const details = (body as { spot_order_book_details?: unknown } | null)?.spot_order_book_details;
  return (Array.isArray(details) ? (details as LighterSpotDetail[]) : []).flatMap((detail): BookSpotMarket[] => {
    const id = finite(detail?.market_id);
    const sizeDecimals = finite(detail?.size_decimals);
    const priceDecimals = finite(detail?.price_decimals);
    const baseToken = finite(detail?.base_asset_id);
    const quoteToken = finite(detail?.quote_asset_id);
    if (typeof detail?.symbol !== "string" || id === undefined || sizeDecimals === undefined || priceDecimals === undefined) return [];
    if (baseToken === undefined || quoteToken === undefined || (detail.status !== undefined && detail.status !== "active")) return [];
    const [base, quote] = detail.symbol.split("/");
    if (!base || quote !== "USDC") return [];
    const price = finite(detail.last_trade_price);
    return [
      {
        venue: "lighter",
        id,
        coin: detail.symbol,
        base,
        asset: base.replace(/^rh(?=[A-Z])/, ""),
        name: base,
        quote: "USDC",
        assetId: id,
        szDecimals: sizeDecimals,
        priceDecimals,
        baseToken,
        quoteToken,
        minBaseAmount: finite(detail.min_base_amount),
        minQuoteAmount: finite(detail.min_quote_amount),
        takerFee: finite(detail.taker_fee),
        category: lighterCategory(base),
        price: price && price > 0 ? price : undefined,
        change24h: finite(detail.daily_price_change),
        volume24h: finite(detail.daily_quote_token_volume),
      },
    ];
  });
}

/** A book spot market as a spot pair for the search, watchlist and swap view. */
export function bookSpotListing(market: BookSpotMarket): SpotListing {
  return {
    id: `${market.venue}:${market.id}`,
    venue: market.venue,
    address: bookSpotRef(market.venue, market.id),
    symbol: market.base,
    name: market.name,
    asset: market.asset,
    category: market.category,
    verified: true,
    price: market.price,
    change24h: market.change24h,
    volume24h: market.volume24h,
    // Dollar tokens (USDH, USDT0, USDE…) stay listed but sort last, like Jupiter's.
    ...(/USD/i.test(market.base) && { stable: true }),
  };
}

/**
 * The Hyperliquid or Lighter spot market an asset trades on when no pool venue lists it (/swap on testnet, HYPE):
 * the enabled venue's market for that asset with the most 24h volume. Null when neither lists it.
 */
export function pickBookSpotListing(listings: SpotListing[], asset: string, enabled: Record<BookSpotVenue, boolean>): SpotListing | null {
  const candidates = listings.filter(
    (listing) => (listing.venue === "hyperliquid" || listing.venue === "lighter") && enabled[listing.venue] && assetSymbolOf(listing) === asset,
  );
  candidates.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  return candidates[0] ?? null;
}
