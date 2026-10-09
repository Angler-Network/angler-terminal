import type { BookSide, TapeTrade } from "@/lib/trading/orderbook";
import type { AccountSnapshot, Candle, VenueMarket, VenueOpenOrder, VenuePosition } from "../types";

/**
 * Orderly payloads mapped to the terminal's venue types. Pure, unit-tested. Markets come from `/v1/public/info`
 * (lot and tick sizes, minimums, margin) and `/v1/public/futures` (mark, 24h, open interest); markets a single broker
 * listed for itself (`broker_id` set, "PERP_AAOI_USDC_mythos") are left out.
 */

export interface OrderlyInfoRow {
  symbol: string;
  broker_id?: string | null;
  status?: string;
  base_tick?: number;
  quote_tick?: number;
  base_min?: number;
  min_notional?: number;
  base_imr?: number;
}

export interface OrderlyFuturesRow {
  symbol: string;
  mark_price?: number;
  "24h_open"?: number;
  "24h_close"?: number;
  "24h_amount"?: number;
  open_interest?: number;
}

/** The lot and price steps per Orderly symbol, which orders round to (a lot can be 100 for 1000PEPE). */
export interface OrderlySteps {
  baseTick: number;
  quoteTick: number;
}

const num = (value: unknown) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
};

/** Decimals of a tick such as 0.00001 (5), 0.1 (1) or 100 (0). */
export function tickDecimals(tick: number | undefined) {
  if (!tick || tick >= 1) return 0;
  return Math.max(0, Math.round(-Math.log10(tick) + 1e-9));
}

/** "PERP_BTC_USDC" → "BTC"; null for anything else (broker-only markets carry a suffix). */
export function orderlyBase(symbol: string) {
  const match = /^PERP_([A-Z0-9]+)_USDC$/.exec(symbol);
  return match ? match[1] : null;
}

export function readOrderlyMarkets(info: OrderlyInfoRow[], futures: OrderlyFuturesRow[]): { markets: VenueMarket[]; steps: Map<string, OrderlySteps> } {
  const futuresOf = new Map(futures.map((row) => [row.symbol, row]));
  const steps = new Map<string, OrderlySteps>();
  const markets = info.flatMap((row, index): VenueMarket[] => {
    const base = orderlyBase(row.symbol);
    if (!base || row.broker_id || (row.status && row.status !== "ACTIVE")) return [];
    const stats = futuresOf.get(row.symbol);
    const mark = num(stats?.mark_price);
    const open = num(stats?.["24h_open"]);
    const close = num(stats?.["24h_close"]);
    const imr = num(row.base_imr);
    steps.set(row.symbol, { baseTick: num(row.base_tick) ?? 1, quoteTick: num(row.quote_tick) ?? 0.01 });
    return [
      {
        venue: "orderly",
        coin: row.symbol,
        symbol: base,
        dex: "",
        assetId: index,
        szDecimals: tickDecimals(num(row.base_tick)),
        priceDecimals: tickDecimals(num(row.quote_tick)),
        minBaseAmount: num(row.base_min) ?? 0,
        minQuoteAmount: num(row.min_notional) ?? 10,
        maxLeverage: imr && imr > 0 ? Math.max(1, Math.round(1 / imr)) : 10,
        kind: "crypto",
        onlyIsolated: false,
        markPx: mark && mark > 0 ? mark : undefined,
        midPx: mark && mark > 0 ? mark : undefined,
        volume24hUsd: num(stats?.["24h_amount"]),
        change24hPct: open && close ? ((close - open) / open) * 100 : undefined,
        openInterestUsd: mark && num(stats?.open_interest) !== undefined ? num(stats?.open_interest)! * mark : undefined,
      },
    ];
  });
  return { markets, steps };
}

/** Rounds a size down to the market's lot (Orderly rejects sizes off the lot). */
export function roundToTick(value: number, tick: number) {
  if (!(tick > 0)) return value;
  const steps = Math.floor(value / tick + 1e-9);
  return Number((steps * tick).toFixed(tickDecimals(tick)));
}

export interface OrderlyPositionsData {
  free_collateral?: number;
  total_collateral_value?: number;
  rows?: Array<{
    symbol: string;
    position_qty?: number;
    average_open_price?: number;
    mark_price?: number;
    unsettled_pnl?: number;
    est_liq_price?: number;
    leverage?: number;
    margin_mode?: string;
    cost_position?: number;
  }>;
}

export interface OrderlyOrderRow {
  order_id: number;
  symbol: string;
  side?: string;
  type?: string;
  price?: number | null;
  quantity?: number;
  executed?: number;
  reduce_only?: boolean | null;
  created_time?: number;
  /** Set when the order belongs to an algo order (a bracket's entry). */
  algo_order_id?: number | null;
}

/** A row of `/v1/algo/orders` (only the fields a bracket entry needs). */
export interface OrderlyAlgoRow {
  algo_order_id: number;
  symbol: string;
  algo_type?: string;
  side?: string;
  type?: string;
  price?: number | null;
  quantity?: number;
  total_executed_quantity?: number;
  algo_status?: string;
  parent_algo_order_id?: number;
  created_time?: number | string;
}

const OPEN_ALGO = new Set(["NEW", "PARTIAL_FILLED", "REPLACED"]);

/**
 * Bracket entries (a limit order placed with its TP/SL as one `BRACKET` algo order) still waiting: shown as open orders
 * with a negative `oid` (minus the algo order id), so cancelling one cancels the whole bracket through
 * `/v1/algo/order` instead of leaving its TP/SL behind.
 */
export function orderlyBracketOrders(algos: OrderlyAlgoRow[]) {
  return algos.filter((row) => row.algo_type === "BRACKET" && !row.parent_algo_order_id && OPEN_ALGO.has(row.algo_status ?? "NEW"));
}

/** Positions (`/v1/positions`), open orders (`/v1/orders?status=INCOMPLETE` and bracket entries) and collateral as one snapshot. */
export function readOrderlyAccount(markets: VenueMarket[], positions: OrderlyPositionsData, orders: OrderlyOrderRow[], algos: OrderlyAlgoRow[] = []): AccountSnapshot {
  const symbolOf = (coin: string) => markets.find((market) => market.coin === coin)?.symbol ?? orderlyBase(coin) ?? coin;
  const open: VenuePosition[] = (positions.rows ?? []).flatMap((row) => {
    const size = num(row.position_qty) ?? 0;
    if (!size) return [];
    const entryPx = num(row.average_open_price) ?? 0;
    const mark = num(row.mark_price) ?? entryPx;
    const value = Math.abs(size * mark);
    const pnl = (mark - entryPx) * size;
    const leverage = num(row.leverage) ?? 1;
    const margin = value / Math.max(1, leverage);
    const liq = num(row.est_liq_price);
    return [
      {
        venue: "orderly",
        coin: row.symbol,
        symbol: symbolOf(row.symbol),
        dex: "",
        size,
        entryPx,
        positionValue: value,
        unrealizedPnl: pnl,
        returnOnEquity: margin > 0 ? pnl / margin : 0,
        liquidationPx: liq && liq > 0 ? liq : null,
        leverage,
        leverageType: row.margin_mode === "ISOLATED" ? "isolated" : "cross",
      },
    ];
  });
  const brackets = orderlyBracketOrders(algos);
  const bracketIds = new Set(brackets.map((row) => row.algo_order_id));
  // A bracket's entry can also show as a plain order: it's listed once, as the bracket (cancel takes its TP/SL too).
  const plain = orders.filter((row) => !(row.algo_order_id && bracketIds.has(row.algo_order_id)));
  const bracketRows: VenueOpenOrder[] = brackets.map((row) => {
    const quantity = num(row.quantity) ?? 0;
    return {
      venue: "orderly",
      coin: row.symbol,
      symbol: symbolOf(row.symbol),
      dex: "",
      oid: -row.algo_order_id,
      side: row.side === "SELL" ? "sell" : "buy",
      limitPx: num(row.price) ?? 0,
      size: Math.max(0, quantity - (num(row.total_executed_quantity) ?? 0)),
      origSize: quantity,
      orderType: "limit · tp/sl",
      reduceOnly: false,
      timestamp: num(row.created_time) ?? 0,
    };
  });
  const resting: VenueOpenOrder[] = plain.map((row) => {
    const quantity = num(row.quantity) ?? 0;
    return {
      venue: "orderly",
      coin: row.symbol,
      symbol: symbolOf(row.symbol),
      dex: "",
      oid: row.order_id,
      side: row.side === "SELL" ? "sell" : "buy",
      limitPx: num(row.price) ?? 0,
      size: Math.max(0, quantity - (num(row.executed) ?? 0)),
      origSize: quantity,
      orderType: (row.type ?? "LIMIT").replace(/_/g, " ").toLowerCase(),
      reduceOnly: Boolean(row.reduce_only),
      timestamp: num(row.created_time) ?? 0,
    };
  });
  return {
    positions: open,
    orders: [...resting, ...bracketRows],
    accountValue: num(positions.total_collateral_value) ?? 0,
    withdrawable: num(positions.free_collateral) ?? 0,
  };
}

/** TradingView-style `/tv/history`: arrays t (seconds), o, h, l, c, v. */
export function readOrderlyCandles(body: unknown): Candle[] {
  const data = (body ?? {}) as { s?: string; t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[]; v?: number[] };
  if (data.s !== "ok" || !Array.isArray(data.t)) return [];
  return data.t.flatMap((time, index) => {
    const close = data.c?.[index];
    if (!Number.isFinite(time) || typeof close !== "number") return [];
    return [{ time: time * 1000, open: data.o?.[index] ?? close, high: data.h?.[index] ?? close, low: data.l?.[index] ?? close, close, volume: data.v?.[index] ?? 0 }];
  });
}

/** The `{symbol}@orderbook` stream: a full depth-100 snapshot, `asks` / `bids` as [price, quantity]. */
export function readOrderlyBook(data: unknown): BookSide | null {
  const body = (data ?? {}) as { asks?: unknown; bids?: unknown };
  if (!Array.isArray(body.asks) || !Array.isArray(body.bids)) return null;
  const side = (rows: unknown[]) =>
    rows.flatMap((row) => {
      if (!Array.isArray(row)) return [];
      const price = num(row[0]);
      const size = num(row[1]);
      return price && price > 0 && size && size > 0 ? [{ price, size }] : [];
    });
  return { bids: side(body.bids), asks: side(body.asks) };
}

/** The `{symbol}@trade` stream: { price, size, side } with the push's `ts`. */
export function readOrderlyTrade(data: unknown, ts: number, id: string): TapeTrade | null {
  const body = (data ?? {}) as { price?: unknown; size?: unknown; side?: unknown };
  const price = num(body.price);
  const size = num(body.size);
  if (!price || !size) return null;
  return { id, price, size, side: body.side === "SELL" ? "sell" : "buy", time: ts };
}
