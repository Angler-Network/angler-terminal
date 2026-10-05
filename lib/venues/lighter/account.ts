import type { AccountSnapshot, VenueOpenOrder, VenuePosition } from "../types";
import { leverageFromPercent } from "./pricing";

/**
 * Pure readers for Lighter account payloads: REST (`accountsByL1Address`, `accountOrders`) and the WebSocket
 * channels `account_all/{account}` (positions), `user_stats/{account}` (balances) and
 * `account_all_orders/{account}` (open orders). `subscribed/*` messages are snapshots; `update/*` messages only
 * carry what changed, keyed by market (positions) or order index (orders).
 */

type Fields = Record<string, unknown>;

function fields(value: unknown): Fields {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Fields) : {};
}

function number(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

/** Master account index for an L1 address, or null when the address has no Lighter account yet (code 21100). */
export function readAccountIndex(body: unknown): number | null {
  const record = fields(body);
  if (record.code === 21100) return null;
  const subAccounts = Array.isArray(record.sub_accounts) ? record.sub_accounts : [];
  // The master account has account_type 0; fall back to the lowest index.
  const accounts = subAccounts.map(fields).filter((entry) => Number.isSafeInteger(entry.index));
  const master = accounts.find((entry) => entry.account_type === 0) ?? accounts.sort((a, b) => number(a.index) - number(b.index))[0];
  return master ? number(master.index) : null;
}

export function readPosition(value: unknown): VenuePosition | null {
  const position = fields(value);
  const symbol = typeof position.symbol === "string" ? position.symbol.toUpperCase() : "";
  const sign = number(position.sign) < 0 ? -1 : 1;
  const size = sign * Math.abs(number(position.position));
  if (!symbol || !size) return null;
  const leverage = leverageFromPercent(position.initial_margin_fraction as string);
  const positionValue = Math.abs(number(position.position_value));
  const unrealizedPnl = number(position.unrealized_pnl);
  const margin = position.margin_mode === 1 ? number(position.allocated_margin) : positionValue / leverage;
  const liquidation = number(position.liquidation_price);
  return {
    venue: "lighter",
    coin: symbol,
    symbol,
    dex: "",
    size,
    entryPx: number(position.avg_entry_price),
    positionValue,
    unrealizedPnl,
    returnOnEquity: margin > 0 ? unrealizedPnl / margin : 0,
    liquidationPx: liquidation > 0 ? liquidation : null,
    leverage,
    leverageType: position.margin_mode === 1 ? "isolated" : "cross",
  };
}

/** Statuses of orders still working on the book (or waiting for a trigger). */
const LIVE_STATUSES = new Set(["open", "pending", "in-progress"]);

const ORDER_TYPES: Record<string, string> = {
  limit: "Limit",
  market: "Market",
  "stop-loss": "Stop Market",
  "stop-loss-limit": "Stop Limit",
  "take-profit": "Take Profit Market",
  "take-profit-limit": "Take Profit Limit",
  twap: "TWAP",
};

/** One `Order` JSON as an open order, or null when it isn't live any more. */
export function readOpenOrder(value: unknown, symbolForMarket: (marketId: number) => string | undefined): VenueOpenOrder | null {
  const order = fields(value);
  const status = typeof order.status === "string" ? order.status : "";
  const marketId = number(order.market_index);
  const symbol = symbolForMarket(marketId);
  if (!LIVE_STATUSES.has(status) || !symbol || !Number.isSafeInteger(order.order_index)) return null;
  const remaining = number(order.remaining_base_amount);
  const timestamp = number(order.created_at) || number(order.timestamp);
  return {
    venue: "lighter",
    coin: symbol,
    symbol,
    dex: "",
    oid: order.order_index as number,
    side: order.is_ask === true ? "sell" : "buy",
    limitPx: number(order.price),
    size: remaining,
    origSize: number(order.initial_base_amount) || remaining,
    orderType: ORDER_TYPES[order.type as string] ?? String(order.type ?? "Order"),
    reduceOnly: order.reduce_only === true,
    // created_at is in seconds on some payloads and milliseconds on others.
    timestamp: timestamp > 0 && timestamp < 1e12 ? timestamp * 1000 : timestamp,
  };
}

export interface LighterAccountState {
  positions: Map<number, VenuePosition>;
  orders: Map<number, VenueOpenOrder>;
  accountValue: number;
  withdrawable: number;
}

export function emptyAccountState(): LighterAccountState {
  return { positions: new Map(), orders: new Map(), accountValue: 0, withdrawable: 0 };
}

/** `account_all` message: positions keyed by market id. Snapshots replace, updates merge (size 0 removes). */
export function applyAccountAll(state: LighterAccountState, message: unknown, isSnapshot: boolean) {
  const positions = fields(fields(message).positions);
  if (isSnapshot) state.positions.clear();
  for (const [market, value] of Object.entries(positions)) {
    const position = readPosition(value);
    if (position) state.positions.set(Number(market), position);
    else state.positions.delete(Number(market));
  }
}

/** `user_stats` message: portfolio value and the balance available to withdraw. */
export function applyUserStats(state: LighterAccountState, message: unknown) {
  const stats = fields(fields(message).stats);
  if (stats.portfolio_value !== undefined) state.accountValue = number(stats.portfolio_value);
  if (stats.available_balance !== undefined) state.withdrawable = number(stats.available_balance);
}

/** `account_all_orders` message: orders by market. Snapshots replace; updates upsert and drop finished orders. */
export function applyOrders(
  state: LighterAccountState,
  message: unknown,
  isSnapshot: boolean,
  symbolForMarket: (marketId: number) => string | undefined,
) {
  const byMarket = fields(fields(message).orders);
  if (isSnapshot) state.orders.clear();
  for (const list of Object.values(byMarket)) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      const index = fields(value).order_index;
      if (!Number.isSafeInteger(index)) continue;
      const order = readOpenOrder(value, symbolForMarket);
      if (order) state.orders.set(index as number, order);
      else state.orders.delete(index as number);
    }
  }
}

export function toSnapshot(state: LighterAccountState): AccountSnapshot {
  return {
    positions: [...state.positions.values()],
    orders: [...state.orders.values()].sort((a, b) => b.timestamp - a.timestamp),
    accountValue: state.accountValue,
    withdrawable: state.withdrawable,
  };
}

export type OrderOutcome =
  | { state: "working" }
  | { state: "filled"; orderIndex: number; filledSize: number; avgPx: number }
  | { state: "resting"; orderIndex: number }
  | { state: "canceled"; status: string };

/**
 * Where an order from `accountOrders` stands. IOC orders end filled, partly filled then canceled (counts as
 * filled), or canceled with a reason.
 */
export function readOrderOutcome(value: unknown): OrderOutcome {
  const order = fields(value);
  const status = typeof order.status === "string" ? order.status : "";
  const orderIndex = number(order.order_index);
  const filledSize = number(order.filled_base_amount);
  const filledQuote = number(order.filled_quote_amount);
  const avgPx = filledSize > 0 ? filledQuote / filledSize : 0;
  if (status === "filled" || (status.startsWith("canceled") && filledSize > 0)) return { state: "filled", orderIndex, filledSize, avgPx };
  if (status === "open") return { state: "resting", orderIndex };
  if (status.startsWith("canceled")) return { state: "canceled", status };
  return { state: "working" };
}
