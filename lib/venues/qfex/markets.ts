import type { BookLevel, BookSide, TapeTrade } from "@/lib/trading/orderbook";
import type { AccountSnapshot, Candle, VenueMarket, VenueOpenOrder, VenuePosition } from "../types";

/**
 * QFEX's wire shapes (checked against the live API, `fixtures/`) and their mapping to the terminal's. Markets are
 * `NVDA-USD`; only USD-quoted, active ones are listed (KRW, JPY… markets price in their own currency, which the terminal
 * would show as dollars). Pure: tested.
 */

export interface QfexRefdataRow {
  symbol: string;
  base_asset: string;
  quote_asset: string;
  status?: string;
  product_category?: string;
  tick_size: string;
  lot_size: string;
  min_quantity?: string;
  max_quantity?: string;
  min_price?: string;
  max_price?: string;
  default_max_leverage?: number;
  price_change_24h?: string;
}

export interface QfexContractRow {
  ticker_id: string;
  last_price?: string;
  index_price?: string;
  target_volume?: string;
  open_interest_usd?: string;
  funding_rate?: string;
}

/** What rounding an order on a market needs, beside the terminal's `VenueMarket`. */
export interface QfexMarketInfo {
  symbol: string;
  tick: string;
  lot: string;
  minQuantity: number;
  maxQuantity: number;
}

const num = (value: unknown) => {
  if (value === "" || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const SYMBOL = /^[A-Z0-9]{1,20}$/;

/** Decimals of a step such as "0.001" (3) or "1" (0). */
export function stepDecimals(step: string) {
  const [, fraction = ""] = step.split(".");
  return fraction.replace(/0+$/, "").length;
}

/**
 * QFEX's taker fee at its entry tier (under $2M of 30-day volume): 0.10% on single stocks, 0.05% on indices,
 * commodities and FX. Depositors pay less on some markets; this is for cost comparisons only.
 */
export function qfexTakerFee(category: string | undefined) {
  return category === "EQUITY" ? 0.001 : 0.0005;
}

/** Active USD-quoted markets with their latest prices and stats, and the rounding details per market. */
export function readQfexMarkets(refdata: QfexRefdataRow[], contracts: QfexContractRow[]): { markets: VenueMarket[]; info: Map<string, QfexMarketInfo> } {
  const stats = new Map(contracts.map((row) => [row.ticker_id, row]));
  const markets: VenueMarket[] = [];
  const info = new Map<string, QfexMarketInfo>();
  for (const row of refdata) {
    if (row.quote_asset !== "USD" || row.status !== "ACTIVE" || !SYMBOL.test(row.base_asset) || !num(row.tick_size) || !num(row.lot_size)) continue;
    const contract = stats.get(row.symbol);
    const last = num(contract?.last_price) ?? num(contract?.index_price);
    markets.push({
      venue: "qfex",
      coin: row.symbol,
      symbol: row.base_asset,
      dex: "",
      assetId: 0,
      szDecimals: stepDecimals(row.lot_size),
      priceDecimals: stepDecimals(row.tick_size),
      minBaseAmount: num(row.min_quantity),
      maxLeverage: Math.max(1, Math.floor(row.default_max_leverage ?? 1)),
      takerFee: qfexTakerFee(row.product_category),
      kind: "stock",
      onlyIsolated: false,
      markPx: last,
      midPx: last,
      volume24hUsd: num(contract?.target_volume),
      change24hPct: num(row.price_change_24h),
      openInterestUsd: num(contract?.open_interest_usd),
    });
    info.set(row.symbol, {
      symbol: row.symbol,
      tick: row.tick_size,
      lot: row.lot_size,
      minQuantity: num(row.min_quantity) ?? 0,
      maxQuantity: num(row.max_quantity) ?? Number.POSITIVE_INFINITY,
    });
  }
  return { markets, info };
}

/**
 * Hourly funding per symbol as a fraction. QFEX publishes the rate in percent per hour (its final rate is the premium in
 * bps divided by 100), and 0 outside each market's funding hours.
 */
export function readQfexFunding(refdata: QfexRefdataRow[], contracts: QfexContractRow[]) {
  const listed = new Map(refdata.filter((row) => row.quote_asset === "USD" && row.status === "ACTIVE" && SYMBOL.test(row.base_asset)).map((row) => [row.symbol, row.base_asset]));
  return contracts.flatMap((row) => {
    const symbol = listed.get(row.ticker_id);
    const rate = num(row.funding_rate);
    return symbol && rate !== undefined ? [{ symbol, hourly: rate / 100 }] : [];
  });
}

/**
 * QFEX symbols that are also crypto tickers elsewhere (PURR, QNT, B…) name different assets. The terminal matches
 * markets across venues by symbol, so such a QFEX market is dropped when another venue lists the symbol as crypto at a
 * price more than 30% away (or with no price to compare): a crypto order must never route to a stock.
 */
export function dropCryptoClashes(qfex: VenueMarket[], others: VenueMarket[]) {
  const crypto = new Map<string, number | undefined>();
  for (const market of others) {
    if (market.kind !== "crypto") continue;
    const key = market.symbol.toUpperCase();
    if (!crypto.has(key)) crypto.set(key, market.markPx ?? market.midPx);
  }
  return qfex.filter((market) => {
    const key = market.symbol.toUpperCase();
    if (!crypto.has(key)) return true;
    const theirs = crypto.get(key);
    const ours = market.markPx ?? market.midPx;
    if (!theirs || !ours) return false;
    return Math.abs(ours - theirs) / theirs <= 0.3;
  });
}

const level = (price: unknown, size: unknown): BookLevel | null => {
  const p = num(price);
  const s = num(size);
  return p && p > 0 && s && s > 0 ? { price: p, size: s } : null;
};

/** A book from the REST snapshot (`bids`/`asks`, every tick including empty ones) or the `level2` stream (`bid`/`ask`). */
export function readQfexBook(body: unknown): BookSide | null {
  const data = (body ?? {}) as { bids?: unknown; asks?: unknown; bid?: unknown; ask?: unknown };
  const bids = data.bids ?? data.bid;
  const asks = data.asks ?? data.ask;
  if (!Array.isArray(bids) || !Array.isArray(asks)) return null;
  const read = (rows: unknown[]) => rows.flatMap((row) => (Array.isArray(row) ? [level(row[0], row[1])].filter((entry): entry is BookLevel => entry !== null) : []));
  return { bids: read(bids).sort((a, b) => b.price - a.price), asks: read(asks).sort((a, b) => a.price - b.price) };
}

/** A `trade` message from the market data stream. */
export function readQfexTrade(message: unknown): TapeTrade | null {
  const body = (message ?? {}) as { trade_id?: unknown; price?: unknown; size?: unknown; side?: unknown; time?: unknown };
  const price = num(body.price);
  const size = num(body.size);
  if (!price || !size) return null;
  const time = typeof body.time === "string" ? Date.parse(body.time) : Date.now();
  return { id: String(body.trade_id ?? `${time}-${price}-${size}`), price, size, side: body.side === "sell" ? "sell" : "buy", time: Number.isFinite(time) ? time : Date.now() };
}

/** Chart intervals → QFEX candle resolutions. Intervals it lacks are merged from smaller ones by the chart. */
export const QFEX_INTERVALS: Record<string, string> = {
  "1m": "1MIN",
  "5m": "5MINS",
  "15m": "15MINS",
  "30m": "30MINS",
  "1h": "1HOUR",
  "4h": "4HOURS",
  "1d": "1DAY",
};

/** `/candles/{symbol}` (newest first) → oldest-first candles. */
export function readQfexCandles(body: unknown): Candle[] {
  const rows = (body as { candles?: unknown })?.candles;
  return (Array.isArray(rows) ? rows : [])
    .flatMap((row: Record<string, unknown>) => {
      const close = num(row.close);
      const time = typeof row.startedAt === "string" ? Date.parse(row.startedAt) : NaN;
      if (close === undefined || !Number.isFinite(time)) return [];
      return [{ time, open: num(row.open) ?? close, high: num(row.high) ?? close, low: num(row.low) ?? close, close, volume: num(row.usdVolume) ?? 0 }];
    })
    .sort((a, b) => a.time - b.time);
}

/** A position as REST `/user/positions` or the `positions` stream sends it. */
export interface QfexPositionRow {
  symbol: string;
  position: number;
  average_price?: number;
  unrealised_pnl?: number;
  leverage?: number;
  margin?: number;
  margin_alloc?: number;
  margin_mode?: string;
}

export interface QfexBalance {
  available_balance?: number;
  position_margin?: number;
  order_margin?: number;
  unrealised_pnl?: number;
}

/** A resting order (`order_response`, `all_orders_response`) or stop order (`stop_order_response`), normalized. */
export interface QfexOrderRow {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  price: number;
  quantity: number;
  remaining: number;
  time: number;
  stop: boolean;
}

/** Order statuses that leave an order resting on the book. */
export const QFEX_LIVE_STATUSES = new Set(["ACK", "MODIFIED"]);

/** Readable reasons for the order statuses QFEX answers instead of a fill. */
const STATUS_MESSAGES: Record<string, string> = {
  FAILED_MARGIN_CHECK: "Not enough margin on QFEX for this order.",
  REJECTED_MARKET_CLOSED: "QFEX isn't taking orders on this market right now.",
  REJECTED_LESS_THAN_MIN_NOTIONAL: "The order is below QFEX's minimum size.",
  QUANTITY_LESS_THAN_MIN_QUANTITY: "The order is below QFEX's minimum size.",
  QUANTITY_GREATER_THAN_MAX_QUANTITY: "The order is above QFEX's maximum size.",
  REJECTED_GREATER_THAN_MAX_PRICE_BAND: "The price is outside QFEX's allowed band.",
  REJECTED_LESS_THAN_MIN_PRICE_BAND: "The price is outside QFEX's allowed band.",
  PRICE_LESS_THAN_MIN_PRICE: "The price is outside QFEX's allowed band.",
  PRICE_GREATER_THAN_MAX_PRICE: "The price is outside QFEX's allowed band.",
  REJECTED_WOULD_BREACH_MAX_POSITION: "This would pass QFEX's maximum position.",
  REJECTED_WOULD_BREACH_MAX_NOTIONAL: "This would pass QFEX's maximum position.",
  REJECTED_OPEN_INTEREST_LIMIT: "QFEX's open interest limit on this market is reached.",
  REJECTED_TOTAL_OPEN_INTEREST_LIMIT: "QFEX's open interest limit is reached.",
  REJECTED_TOO_MANY_OPEN_ORDERS: "Too many open orders on QFEX.",
  USER_IN_LIQUIDATION: "This QFEX account is being liquidated.",
  PERMISSION_DENIED: "The QFEX API key isn't allowed to trade. Create one with \"Execute orders\" on.",
  RATE_LIMITED: "QFEX is rate limiting this account. Wait a moment and try again.",
  INVALID_TAKE_PROFIT_PRICE: "The take-profit price isn't valid on QFEX.",
  INVALID_STOP_LOSS_PRICE: "The stop-loss price isn't valid on QFEX.",
  IOC_CANCELLED: "Nothing filled: QFEX's book had no liquidity at an acceptable price.",
};

export function qfexStatusMessage(status: string) {
  return STATUS_MESSAGES[status] ?? `QFEX answered ${status.replace(/_/g, " ").toLowerCase()}.`;
}

/** QFEX ids are UUIDs: the terminal's numeric `oid` is a stable hash of one (the venue keeps the map back). */
export function oidOf(id: string) {
  let hash = 0n;
  for (const char of id) hash = (hash * 131n + BigInt(char.charCodeAt(0))) % 9_007_199_254_740_881n;
  return Number(hash);
}

export function readQfexAccount(markets: VenueMarket[], positions: QfexPositionRow[], orders: QfexOrderRow[], balance: QfexBalance | null): AccountSnapshot {
  const bySymbol = new Map(markets.map((market) => [market.coin, market]));
  const symbolOf = (name: string) => bySymbol.get(name)?.symbol ?? name.replace(/-USD$/, "");
  return {
    positions: positions.flatMap((row): VenuePosition[] => {
      const size = row.position;
      if (!size) return [];
      const entry = row.average_price ?? 0;
      const pnl = row.unrealised_pnl ?? 0;
      const mark = bySymbol.get(row.symbol)?.markPx ?? (entry ? entry + pnl / size : 0);
      const value = Math.abs(size * mark);
      const leverage = row.leverage && row.leverage > 0 ? row.leverage : 1;
      const margin = row.margin ?? row.margin_alloc ?? value / leverage;
      return [
        {
          venue: "qfex",
          coin: row.symbol,
          symbol: symbolOf(row.symbol),
          dex: "",
          size,
          entryPx: entry,
          positionValue: value,
          unrealizedPnl: pnl,
          returnOnEquity: margin > 0 ? pnl / margin : 0,
          liquidationPx: null,
          leverage,
          leverageType: row.margin_mode?.toLowerCase().includes("isolated") ? "isolated" : "cross",
        },
      ];
    }),
    orders: orders.map(
      (row): VenueOpenOrder => ({
        venue: "qfex",
        coin: row.symbol,
        symbol: symbolOf(row.symbol),
        dex: "",
        oid: oidOf(row.id),
        side: row.side === "BUY" ? "buy" : "sell",
        limitPx: row.price,
        size: row.remaining,
        origSize: row.quantity,
        orderType: row.type === "TAKE_PROFIT" ? "Take profit" : row.type === "STOP_LOSS" ? "Stop loss" : row.type === "MARKET" ? "Market" : "Limit",
        reduceOnly: row.stop,
        timestamp: row.time,
      }),
    ),
    accountValue: balance ? (balance.available_balance ?? 0) + (balance.position_margin ?? 0) + (balance.order_margin ?? 0) + (balance.unrealised_pnl ?? 0) : 0,
    withdrawable: balance?.available_balance ?? 0,
  };
}

/** A quantity or price rounded to its step, as a number with the step's decimals (down for sizes, nearest for prices). */
export function roundToStep(value: number, step: string, mode: "down" | "nearest" = "nearest") {
  const unit = Number(step);
  const steps = mode === "down" ? Math.floor(value / unit + 1e-9) : Math.round(value / unit);
  return Number((steps * unit).toFixed(stepDecimals(step)));
}
