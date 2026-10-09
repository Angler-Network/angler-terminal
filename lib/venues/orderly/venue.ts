"use client";

import { VenueError, type AccountHandlers, type Candle, type OrderResult, type PerpVenue, type PlaceOrderInput, type PositionRef, type PositionTpsl, type VenueMarket, type VenueOpenOrder } from "../types";
import { ORDERLY_BASE_TAKER_FEE, orderlyConfig } from "./config";
import { readOrderlyAccount, readOrderlyCandles, readOrderlyMarkets, roundToTick, type OrderlyFuturesRow, type OrderlyInfoRow, type OrderlyAlgoRow, type OrderlyOrderRow, type OrderlyPositionsData, type OrderlySteps } from "./markets";
import { orderlyKey } from "./store";

/**
 * Orderly perps as a terminal venue. Public data straight from Orderly's API (open to browsers); orders and account
 * reads signed in this browser by the account's trading key. Our fee is the broker's fee rate, set in Orderly's admin:
 * orders carry no fee field.
 */

const POLL_MS = 3_000;
const MARKETS_TTL_MS = 60_000;
const CONFIRM_TIMEOUT_MS = 8_000;
const CONFIRM_INTERVAL_MS = 500;
/** Chart intervals → `/tv/history` resolutions (minutes, or D/W/M). */
const RESOLUTIONS: Record<string, string> = { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240", "8h": "480", "12h": "720", "1d": "1D", "1w": "1W", "1M": "1M" };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Envelope<T> {
  success: boolean;
  code?: number;
  message?: string;
  data?: T;
}

async function publicGet<T>(path: string): Promise<T> {
  const response = await fetch(`${orderlyConfig.apiUrl}${path}`, { cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok || !body.success || body.data === undefined) throw new VenueError(body.message ? `Orderly: ${body.message}` : `Orderly answered ${response.status}.`);
  return body.data;
}

/** A request signed by the account's trading key; the body is signed exactly as sent. */
async function signed<T>(user: `0x${string}`, method: "GET" | "POST" | "PUT" | "DELETE", pathWithQuery: string, payload?: Record<string, unknown>): Promise<T> {
  const key = orderlyKey(user);
  if (!key) throw new VenueError("Set up Orderly trading first: register and add a trading key from this wallet.");
  // The ed25519 signer loads with the first signed request, not with the page.
  const [{ accountId, secret }, { orderlyHeaders }] = await Promise.all([key, import("./sign")]);
  const body = payload ? JSON.stringify(payload) : "";
  const response = await fetch(`${orderlyConfig.apiUrl}${pathWithQuery}`, {
    method,
    cache: "no-store",
    headers: orderlyHeaders(secret, accountId, Date.now(), method, pathWithQuery, body),
    body: body || undefined,
  });
  const result = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok || !result.success) {
    throw new VenueError(result.message ? `Orderly: ${result.message}` : `Orderly answered ${response.status}.`, result.code !== undefined ? String(result.code) : undefined);
  }
  return result.data as T;
}

/** Our part of the taker fee in bps (the broker rate above Orderly's base), for analytics; 0 on someone else's broker. */
const partnerFeeBps = () => (orderlyConfig.ownBroker ? Math.max(0, (orderlyConfig.takerFee - ORDERLY_BASE_TAKER_FEE) * 10_000) : 0);

interface OrderlyOrderDetail {
  order_id: number;
  status?: string;
  total_executed_quantity?: number;
  executed?: number;
  average_executed_price?: number;
}

function createOrderlyVenue(): PerpVenue {
  let cache: { at: number; data: Promise<{ markets: VenueMarket[]; steps: Map<string, OrderlySteps> }> } | null = null;

  function loadMarkets() {
    if (!cache || Date.now() - cache.at > MARKETS_TTL_MS) {
      const data = Promise.all([publicGet<{ rows: OrderlyInfoRow[] }>("/v1/public/info"), publicGet<{ rows: OrderlyFuturesRow[] }>("/v1/public/futures")]).then(([info, futures]) =>
        readOrderlyMarkets(info.rows ?? [], futures.rows ?? []),
      );
      cache = { at: Date.now(), data };
      data.catch(() => (cache = null));
    }
    return cache.data;
  }

  const listMarkets = async () => (await loadMarkets()).markets;

  async function stepsOf(coin: string) {
    const steps = (await loadMarkets()).steps.get(coin);
    if (!steps) throw new VenueError(`Orderly doesn't list ${coin}.`);
    return steps;
  }

  /** Leverage and margin mode last set per symbol in this session, so they're only sent when they change. */
  const lastSettings = new Map<string, string>();

  async function applySettings(user: `0x${string}`, market: VenueMarket, input: PlaceOrderInput) {
    if (!input.leverage || input.reduceOnly) return;
    const leverage = Math.max(1, Math.min(market.maxLeverage, Math.round(input.leverage)));
    const mode = input.isCross === false ? "ISOLATED" : "CROSS";
    const key = `${user}:${market.coin}`;
    if (lastSettings.get(key) === `${leverage}:${mode}`) return;
    await signed(user, "POST", "/v1/client/leverages", { symbol: market.coin, leverage, margin_mode: mode });
    lastSettings.set(key, `${leverage}:${mode}`);
  }

  /** The order's outcome: market orders fill (or not) at once, so the order is read back until it's final. */
  async function confirm(user: `0x${string}`, orderId: number, kind: PlaceOrderInput["kind"]): Promise<OrderResult> {
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(CONFIRM_INTERVAL_MS);
      const order = await signed<OrderlyOrderDetail>(user, "GET", `/v1/order/${orderId}`).catch(() => null);
      if (!order) continue;
      const filled = order.total_executed_quantity ?? order.executed ?? 0;
      if (order.status === "FILLED" || (filled > 0 && kind === "market" && order.status !== "NEW")) {
        return { status: "filled", oid: orderId, filledSize: filled, avgPx: order.average_executed_price ?? 0, partnerFeeBps: partnerFeeBps() };
      }
      if (order.status === "REJECTED" || order.status === "CANCELLED") throw new VenueError(`Orderly ${order.status === "REJECTED" ? "rejected" : "canceled"} the order.`);
      if (kind === "limit" && order.status === "NEW") return { status: "resting", oid: orderId };
    }
    if (kind === "limit") return { status: "resting", oid: orderId };
    throw new VenueError("Orderly accepted the order but hasn't confirmed the fill yet. Check your positions before trying again.");
  }

  /** TP and SL children of a TP/SL or bracket algo order: reduce-only, triggered by the mark price. */
  function bracketChildren(coin: string, closeSide: "BUY" | "SELL", quoteTick: number, levels: Pick<PositionTpsl, "takeProfit" | "stopLoss">, type = "CLOSE_POSITION") {
    return (
      [
        ["TAKE_PROFIT", levels.takeProfit],
        ["STOP_LOSS", levels.stopLoss],
      ] as const
    ).flatMap(([algoType, price]) =>
      price ? [{ symbol: coin, algo_type: algoType, side: closeSide, type, trigger_price_type: "MARK_PRICE", trigger_price: roundToTick(price, quoteTick), reduce_only: true }] : [],
    );
  }

  /**
   * TP/SL on the whole position: Orderly's `POSITIONAL_TP_SL` algo order, one child per level, each closing the
   * position at market when the mark price crosses it. With `levels.size` it's a `TP_SL` order for that quantity.
   */
  async function placePositionTpsl(user: `0x${string}`, market: VenueMarket, closeSide: "BUY" | "SELL", levels: PositionTpsl) {
    const steps = await stepsOf(market.coin);
    const quantity = levels.size === undefined ? undefined : roundToTick(levels.size, steps.baseTick);
    if (quantity !== undefined && !(quantity > 0)) throw new VenueError(`TP/SL size is below ${market.symbol}'s lot on Orderly (${steps.baseTick}).`);
    const children = bracketChildren(market.coin, closeSide, steps.quoteTick, levels, quantity === undefined ? "CLOSE_POSITION" : "MARKET");
    if (children.length === 0) return;
    await signed(user, "POST", "/v1/algo/order", {
      symbol: market.coin,
      ...(quantity === undefined ? { algo_type: "POSITIONAL_TP_SL" } : { algo_type: "TP_SL", quantity }),
      trigger_price_type: "MARK_PRICE",
      child_orders: children,
    });
  }

  async function placeOrder(user: `0x${string}`, input: PlaceOrderInput): Promise<OrderResult> {
    const { market } = input;
    const withTpsl = Boolean(input.takeProfit || input.stopLoss);
    const steps = await stepsOf(market.coin);
    const quantity = roundToTick(input.size, steps.baseTick);
    if (!(quantity > 0)) throw new VenueError(`Size is below ${market.symbol}'s lot on Orderly (${steps.baseTick}).`);
    await applySettings(user, market, input);
    // A limit entry with TP/SL is one `BRACKET` algo order: the TP/SL (on the whole position, mark price) arm once it fills.
    if (withTpsl && input.kind === "limit" && input.limitPx && !input.reduceOnly) {
      const side = input.side === "buy" ? "BUY" : "SELL";
      const closeSide = side === "BUY" ? "SELL" : "BUY";
      const children = bracketChildren(market.coin, closeSide, steps.quoteTick, { takeProfit: input.takeProfit, stopLoss: input.stopLoss });
      const placed = await signed<{ rows?: Array<{ order_id?: number; algo_type?: string }> }>(user, "POST", "/v1/algo/order", {
        symbol: market.coin,
        algo_type: "BRACKET",
        side,
        type: "LIMIT",
        price: roundToTick(input.limitPx, steps.quoteTick),
        quantity,
        child_orders: [{ symbol: market.coin, algo_type: "POSITIONAL_TP_SL", child_orders: children }],
      });
      const id = placed.rows?.find((row) => row.algo_type === "BRACKET")?.order_id;
      if (!id) throw new VenueError("Orderly didn't confirm the limit order with TP/SL.");
      return { status: "resting", oid: -id };
    }
    const order = await signed<{ order_id: number }>(user, "POST", "/v1/order", {
      symbol: market.coin,
      side: input.side === "buy" ? "BUY" : "SELL",
      order_type: input.kind === "limit" ? "LIMIT" : "MARKET",
      order_quantity: quantity,
      ...(input.kind === "limit" && input.limitPx ? { order_price: roundToTick(input.limitPx, steps.quoteTick) } : {}),
      ...(input.reduceOnly ? { reduce_only: true } : {}),
    });
    const result = await confirm(user, order.order_id, input.kind);
    if (withTpsl && result.status === "filled") {
      try {
        await placePositionTpsl(user, market, input.side === "buy" ? "SELL" : "BUY", { takeProfit: input.takeProfit, stopLoss: input.stopLoss });
      } catch (error) {
        throw new VenueError(`The order filled, but Orderly refused the TP/SL (${error instanceof Error ? error.message : String(error)}). Set it from the position row.`);
      }
    }
    return result;
  }

  async function cancelOrder(user: `0x${string}`, order: Pick<VenueOpenOrder, "coin" | "oid">) {
    // A negative id is a bracket (limit entry with TP/SL): cancelling the algo order takes its TP/SL too.
    if (order.oid < 0) await signed(user, "DELETE", `/v1/algo/order?order_id=${-order.oid}&symbol=${order.coin}`);
    else await signed(user, "DELETE", `/v1/order?order_id=${order.oid}&symbol=${order.coin}`);
  }

  async function closePosition(user: `0x${string}`, position: PositionRef, size?: number): Promise<OrderResult> {
    const market = (await listMarkets()).find((entry) => entry.coin === position.coin);
    if (!market) throw new VenueError(`Orderly doesn't list ${position.symbol} anymore.`);
    const amount = Math.min(size ?? Infinity, Math.abs(position.size));
    return placeOrder(user, { market, side: position.size > 0 ? "sell" : "buy", kind: "market", size: amount, reduceOnly: true });
  }

  async function setPositionTpsl(user: `0x${string}`, position: PositionRef, levels: PositionTpsl) {
    const market = (await listMarkets()).find((entry) => entry.coin === position.coin);
    if (!market) throw new VenueError(`Orderly doesn't list ${position.symbol} anymore.`);
    const partial = levels.size !== undefined && levels.size < Math.abs(position.size);
    await placePositionTpsl(user, market, position.size > 0 ? "SELL" : "BUY", { ...levels, size: partial ? levels.size : undefined });
  }

  /** Positions, open orders and collateral every few seconds (before setup the account is empty). */
  function subscribeAccount(user: `0x${string}`, handlers: AccountHandlers) {
    let active = true;
    const read = async () => {
      if (!orderlyKey(user)) {
        handlers.onSnapshot({ positions: [], orders: [], accountValue: 0, withdrawable: 0 });
        return;
      }
      try {
        const [markets, positions, orders, algos] = await Promise.all([
          listMarkets(),
          signed<OrderlyPositionsData>(user, "GET", "/v1/positions"),
          signed<{ rows?: OrderlyOrderRow[] }>(user, "GET", "/v1/orders?status=INCOMPLETE&size=100"),
          // Bracket entries (limit + TP/SL); a failure here leaves just the plain orders.
          signed<{ rows?: OrderlyAlgoRow[] }>(user, "GET", "/v1/algo/orders?status=INCOMPLETE&algo_type=BRACKET&size=100").catch(() => ({ rows: [] })),
        ]);
        if (active) handlers.onSnapshot(readOrderlyAccount(markets, positions, orders.rows ?? [], algos.rows ?? []));
      } catch (error) {
        if (active) handlers.onError?.(error);
      }
    };
    void read();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void read(), POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }

  async function loadCandles(market: VenueMarket, interval: string, startTime: number): Promise<Candle[]> {
    const resolution = RESOLUTIONS[interval] ?? "60";
    const response = await fetch(
      `${orderlyConfig.apiUrl}/tv/history?symbol=${market.coin}&resolution=${resolution}&from=${Math.floor(startTime / 1000)}&to=${Math.floor(Date.now() / 1000)}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new VenueError(`Orderly answered ${response.status}.`);
    return readOrderlyCandles(await response.json());
  }

  return {
    kind: "perp",
    id: "orderly",
    name: "Orderly",
    network: orderlyConfig.network,
    listMarkets,
    resolveMarket: async (symbol) => (await listMarkets()).find((market) => market.symbol === symbol.toUpperCase()) ?? null,
    placeOrder,
    cancelOrder,
    closePosition,
    setPositionTpsl,
    subscribeAccount,
    loadCandles,
  };
}

export const orderlyVenue = createOrderlyVenue();
