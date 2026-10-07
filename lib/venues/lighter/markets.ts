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
  daily_quote_token_volume?: number;
  /** Percent. */
  daily_price_change?: number;
  /** Undocumented market group: 5 US stocks and ETFs, 6 Asian stocks (see lib/markets/server.ts). */
  strategy_index?: number;
  /** Base units. */
  open_interest?: number | string;
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

function openInterestUsd(detail: Partial<OrderBookDetailLike>) {
  const base = positive(detail.open_interest);
  const mark = positive(detail.mark_price);
  return base && mark ? base * mark : undefined;
}

/** Leverage cap from the market's minimum initial margin fraction (bps of 10000), e.g. 400 → 25x. */
export function maxLeverageFor(minInitialMarginFraction: number) {
  return minInitialMarginFraction > 0 ? Math.max(1, Math.floor(10_000 / minInitialMarginFraction)) : 1;
}

/**
 * Active, visible perp markets as terminal markets. Ids and decimals always come from the API, never hard-coded.
 * Lighter has no asset-class field; its stock groups (strategy 5 and 6) are labelled stock, the rest crypto.
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
        kind: detail.strategy_index === 5 || detail.strategy_index === 6 ? "stock" : "crypto",
        // market_margin_mode 1 = isolated only.
        onlyIsolated: detail.market_config?.market_margin_mode === 1,
        takerFee: detail.is_taker_fee_enabled === false ? 0 : (Number(detail.taker_fee) || 0) / 100,
        markPx: positive(detail.mark_price),
        midPx: positive(detail.last_trade_price),
        volume24hUsd: positive(detail.daily_quote_token_volume),
        change24hPct: typeof detail.daily_price_change === "number" && positive(detail.last_trade_price) ? detail.daily_price_change : undefined,
        openInterestUsd: openInterestUsd(detail),
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

/**
 * Lighter on Robinhood lists mostly stocks but marks every market with strategy 0, so its crypto perps are named here
 * (checked against `orderBookDetails` on 2026-10-07); anything else there is a stock, ETF or commodity.
 */
const RH_CRYPTO = new Set(["BTC", "ETH", "SOL", "XRP", "SUI", "NEAR", "HYPE", "ZEC", "LIT", "VVV", "USELESS", "ANSEM", "CASHCAT", "PONS"]);

/** Markets as the given instance's: its venue id, and on Robinhood the stock/crypto split by symbol. */
export function forInstance(config: { venue: VenueMarket["venue"]; instance: "core" | "rh" }, markets: VenueMarket[]): VenueMarket[] {
  return markets.map((market) => ({
    ...market,
    venue: config.venue,
    ...(config.instance === "rh" ? { kind: RH_CRYPTO.has(market.symbol) ? ("crypto" as const) : ("stock" as const) } : {}),
  }));
}
