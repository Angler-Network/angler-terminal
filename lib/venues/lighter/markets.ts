import type { VenueMarket } from "../types";

/** The fields of `GET /api/v1/orderBookDetails` → `order_book_details[]` the terminal reads. */
export interface OrderBookDetailLike {
  symbol: string;
  market_id: number;
  market_type?: string;
  status: string;
  size_decimals: number;
  price_decimals: number;
  min_base_amount: string;
  min_quote_amount: string;
  /** Basis points of 10000: max leverage = 10000 / it. */
  min_initial_margin_fraction: number;
  mark_price?: string | number;
  last_trade_price?: string | number;
  /** Percent, e.g. "0.0200". */
  taker_fee?: string;
  is_taker_fee_enabled?: boolean;
  market_config?: { hidden?: boolean; market_margin_mode?: number };
}

const SYMBOL_PATTERN = /^[A-Z0-9]{1,20}$/;

function positive(value: unknown) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(number) && number > 0 ? number : undefined;
}

function decimals(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 12 ? value : undefined;
}

/** Leverage cap from the market's minimum initial margin fraction (bps of 10000), e.g. 400 → 25x. */
export function maxLeverageFor(minInitialMarginFraction: number) {
  return minInitialMarginFraction > 0 ? Math.max(1, Math.floor(10_000 / minInitialMarginFraction)) : 1;
}

/**
 * Active, visible perp markets as terminal markets. Ids and decimals always come from the API, never hard-coded.
 * Lighter doesn't say which markets are equities, so every market is labelled crypto (the label only picks icons).
 */
export function marketsFromDetails(details: unknown): VenueMarket[] {
  if (!Array.isArray(details)) return [];
  return details.flatMap((entry): VenueMarket[] => {
    const detail = (entry ?? {}) as Partial<OrderBookDetailLike>;
    const symbol = typeof detail.symbol === "string" ? detail.symbol.toUpperCase() : "";
    const sizeDecimals = decimals(detail.size_decimals);
    const priceDecimals = decimals(detail.price_decimals);
    if (
      !SYMBOL_PATTERN.test(symbol) ||
      typeof detail.market_id !== "number" ||
      detail.status !== "active" ||
      (detail.market_type !== undefined && detail.market_type !== "perp") ||
      detail.market_config?.hidden === true ||
      sizeDecimals === undefined ||
      priceDecimals === undefined
    ) {
      return [];
    }
    return [
      {
        venue: "lighter",
        coin: symbol,
        symbol,
        dex: "",
        assetId: detail.market_id,
        szDecimals: sizeDecimals,
        priceDecimals,
        minBaseAmount: positive(detail.min_base_amount) ?? 0,
        minQuoteAmount: positive(detail.min_quote_amount) ?? 0,
        maxLeverage: maxLeverageFor(Number(detail.min_initial_margin_fraction)),
        kind: "crypto",
        // market_margin_mode 1 = isolated only.
        onlyIsolated: detail.market_config?.market_margin_mode === 1,
        takerFee: detail.is_taker_fee_enabled === false ? 0 : (Number(detail.taker_fee) || 0) / 100,
        markPx: positive(detail.mark_price),
        midPx: positive(detail.last_trade_price),
      },
    ];
  });
}

/** Reads the `orderBookDetails` response body. */
export function readOrderBookDetails(body: unknown): VenueMarket[] {
  const record = (body ?? {}) as { code?: unknown; order_book_details?: unknown };
  return marketsFromDetails(record.order_book_details);
}

export function findLighterMarket(markets: VenueMarket[], symbol: string) {
  const wanted = symbol.toUpperCase();
  return markets.find((market) => market.symbol === wanted) ?? null;
}

export function findLighterMarketById(markets: VenueMarket[], marketId: number) {
  return markets.find((market) => market.assetId === marketId) ?? null;
}
