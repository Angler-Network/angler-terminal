/**
 * Past orders from every perp venue in one shape (positions bar → Order history): Hyperliquid `historicalOrders` and
 * Lighter `accountInactiveOrders`. Pure, unit-tested.
 */
import type { OrderSide, PerpVenueId } from "@/lib/venues/types";

export type OrderOutcome = "filled" | "partial" | "canceled" | "rejected" | "open" | "triggered";

export interface OrderHistoryRow {
  id: string;
  venue: PerpVenueId;
  /** When the order reached its status (ms). */
  time: number;
  symbol: string;
  side: OrderSide;
  /** "Limit", "Market", "Stop market"… */
  type: string;
  /** Limit price; null for market orders (their limit is only a slippage cap). */
  price: number | null;
  triggerPrice: number | null;
  size: number;
  filled: number;
  outcome: OrderOutcome;
  /** Readable status with the venue's reason ("Canceled: margin", "Rejected: post only"). */
  status: string;
  reduceOnly: boolean;
}

const toNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

/** "marginCanceled" → "margin", "badAloPxRejected" → "bad alo px". */
function reasonFrom(code: string, suffix: string) {
  const reason = code.slice(0, -suffix.length).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return reason;
}

/** Final outcome and readable status for a Hyperliquid order status code. */
export function hlOutcome(status: string, filled: number): { outcome: OrderOutcome; status: string } {
  if (status === "filled") return { outcome: "filled", status: "Filled" };
  if (status === "open") return { outcome: "open", status: "Open" };
  if (status === "triggered") return { outcome: "triggered", status: "Triggered" };
  const partial = filled > 0;
  if (status === "canceled") return { outcome: partial ? "partial" : "canceled", status: partial ? "Partly filled, canceled" : "Canceled" };
  if (status.endsWith("Canceled") || status === "scheduledCancel" || status === "internalCancel") {
    const reason = status.endsWith("Canceled") ? reasonFrom(status, "Canceled") : status === "scheduledCancel" ? "scheduled cancel" : "internal";
    return { outcome: partial ? "partial" : "canceled", status: `${partial ? "Partly filled, canceled" : "Canceled"}: ${reason}` };
  }
  if (status.endsWith("Rejected")) return { outcome: "rejected", status: `Rejected: ${reasonFrom(status, "Rejected")}` };
  return { outcome: "rejected", status: status || "Unknown" };
}

/** The parts of a Hyperliquid `historicalOrders` entry the history reads. */
export interface HlHistoricalOrder {
  order: {
    coin: string;
    side: "B" | "A";
    limitPx: string;
    sz: string;
    origSz: string;
    oid: number;
    timestamp: number;
    orderType: string;
    triggerPx: string;
    isTrigger: boolean;
    reduceOnly: boolean;
  };
  status: string;
  statusTimestamp: number;
}

export function fromHlHistoricalOrder(entry: HlHistoricalOrder, symbolOf: (coin: string) => string): OrderHistoryRow {
  const { order } = entry;
  const size = toNumber(order.origSz);
  const filled = Math.max(0, size - toNumber(order.sz));
  const isMarket = order.orderType === "Market" || order.orderType.endsWith("Market");
  return {
    id: `hyperliquid:${order.oid}`,
    venue: "hyperliquid",
    time: entry.statusTimestamp || order.timestamp,
    symbol: symbolOf(order.coin),
    side: order.side === "B" ? "buy" : "sell",
    type: order.orderType.replace(/ (Market|Limit)$/, (part) => part.toLowerCase()),
    price: isMarket ? null : toNumber(order.limitPx) || null,
    triggerPrice: order.isTrigger ? toNumber(order.triggerPx) || null : null,
    size,
    filled,
    reduceOnly: order.reduceOnly,
    ...hlOutcome(entry.status, filled),
  };
}

const LIGHTER_TYPES: Record<string, string> = {
  limit: "Limit",
  market: "Market",
  "stop-loss": "Stop market",
  "stop-loss-limit": "Stop limit",
  "take-profit": "Take profit market",
  "take-profit-limit": "Take profit limit",
  twap: "TWAP",
  "twap-sub": "TWAP slice",
  liquidation: "Liquidation",
};

/** Final outcome and readable status for a Lighter order status ("canceled-too-much-slippage"…). */
export function lighterOutcome(status: string, filled: number): { outcome: OrderOutcome; status: string } {
  if (status === "filled") return { outcome: "filled", status: "Filled" };
  if (status === "open" || status === "pending" || status === "in-progress") return { outcome: "open", status: "Open" };
  if (status.startsWith("canceled")) {
    const reason = status.slice("canceled".length).replace(/^-/, "").replace(/-/g, " ");
    const partial = filled > 0;
    const label = partial ? "Partly filled, canceled" : "Canceled";
    return { outcome: partial ? "partial" : "canceled", status: reason ? `${label}: ${reason}` : label };
  }
  return { outcome: "rejected", status: status || "Unknown" };
}

/** Lighter `Order` from `accountInactiveOrders` (amounts are decimal strings; times are seconds or ms). */
export function fromLighterOrder(
  order: Record<string, unknown>,
  symbolOf: (marketId: number) => string | null,
  venue: "lighter" | "lighterRh" = "lighter",
): OrderHistoryRow | null {
  const marketId = toNumber(order.market_index);
  const symbol = symbolOf(marketId);
  if (!symbol || !Number.isSafeInteger(order.order_index)) return null;
  const size = toNumber(order.initial_base_amount);
  const filled = toNumber(order.filled_base_amount);
  const type = typeof order.type === "string" ? order.type : "";
  const raw = toNumber(order.updated_at) || toNumber(order.timestamp) || toNumber(order.created_at);
  const isMarket = type === "market" || type === "stop-loss" || type === "take-profit" || type === "liquidation";
  return {
    id: `${venue}:${order.order_index}`,
    venue,
    time: raw > 0 && raw < 1e12 ? raw * 1000 : raw,
    symbol,
    side: order.is_ask === true ? "sell" : "buy",
    type: LIGHTER_TYPES[type] ?? (type || "Order"),
    price: isMarket ? null : toNumber(order.price) || null,
    triggerPrice: toNumber(order.trigger_price) || null,
    size,
    filled,
    reduceOnly: order.reduce_only === true,
    ...lighterOutcome(typeof order.status === "string" ? order.status : "", filled),
  };
}
