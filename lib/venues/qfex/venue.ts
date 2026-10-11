"use client";

import { VenueError, type AccountHandlers, type AccountSnapshot, type Candle, type OrderResult, type PerpVenue, type PlaceOrderInput, type PositionRef, type PositionTpsl, type VenueMarket, type VenueOpenOrder } from "../types";
import { qfexApi } from "./api";
import { qfexConfig } from "./config";
import {
  QFEX_INTERVALS,
  QFEX_LIVE_STATUSES,
  oidOf,
  qfexStatusMessage,
  readQfexAccount,
  readQfexCandles,
  readQfexMarkets,
  roundToStep,
  type QfexBalance,
  type QfexContractRow,
  type QfexMarketInfo,
  type QfexOrderRow,
  type QfexPositionRow,
  type QfexRefdataRow,
} from "./markets";
import { qfexSession, type QfexSession } from "./store";
import { qfexSocket, type QfexMessage } from "./trade-socket";

/**
 * QFEX perps as a terminal venue. Market data from our server (QFEX's REST has no CORS); orders, cancels and leverage
 * over QFEX's Trade WebSocket straight from the browser, authenticated with the user's own API key (HMAC signed here)
 * and our builder code on the auth message, which attributes every order on the connection to Angler. The account is
 * the REST snapshot (`/user/positions`, signed, through our proxy) kept current by the `positions` and `balances`
 * streams; open orders come from `get_user_orders`.
 */

const MARKETS_TTL_MS = 60_000;
const POLL_MS = 15_000;
/** How long a limit order is watched for an immediate fill before it's reported resting. */
const LIMIT_SETTLE_MS = 600;
/** Fills can trail the order's final status a moment. */
const FILL_GRACE_MS = 400;
const TERMINAL_FAILURES = new Set(["IOC_CANCELLED", "CANCELLED", "CANCELLED_STP"]);

type OrderResponse = {
  order_id?: string;
  client_order_id?: string;
  symbol?: string;
  status?: string;
  quantity?: number;
  quantity_remaining?: number;
  price?: number;
  side?: string;
  type?: string;
  update_time?: number;
};
type StopResponse = { stop_order_id?: string; client_order_id?: string; symbol?: string; price?: number; quantity?: number; direction?: string; stop_order_type?: string; update_time?: number };
type FillResponse = { order_id?: string; price?: number; quantity?: number };

const isFailure = (status: string) => status !== "ACK" && status !== "FILLED" && status !== "MODIFIED" && !status.startsWith("IOC_");

function createQfexVenue(): PerpVenue {
  let cache: { at: number; data: Promise<{ markets: VenueMarket[]; info: Map<string, QfexMarketInfo> }> } | null = null;
  /** Open orders' QFEX ids by the terminal's `oid`, and whether each is a stop (TP/SL) order. */
  const orderIds = new Map<number, { id: string; symbol: string; stop: boolean }>();
  /** Stop orders placed from this tab: QFEX's order list may not carry them. */
  const stops = new Map<string, QfexOrderRow>();
  const lastLeverage = new Map<string, number>();
  const ordersChanged = new Set<() => void>();

  function loadMarkets() {
    if (!cache || Date.now() - cache.at > MARKETS_TTL_MS) {
      const data = fetch(`${qfexConfig.proxy}/markets`, { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new VenueError(`QFEX markets answered ${response.status}.`);
        const body = (await response.json()) as { refdata?: QfexRefdataRow[]; contracts?: QfexContractRow[] };
        return readQfexMarkets(body.refdata ?? [], body.contracts ?? []);
      });
      cache = { at: Date.now(), data };
      data.catch(() => (cache = null));
    }
    return cache.data;
  }

  const listMarkets = async () => (await loadMarkets()).markets;

  async function infoOf(coin: string) {
    const info = (await loadMarkets()).info.get(coin);
    if (!info) throw new VenueError(`QFEX doesn't list ${coin}.`);
    return info;
  }

  async function requireSession(user: string): Promise<QfexSession> {
    const session = qfexSession(user);
    if (!session) throw new VenueError("Set up QFEX trading first: add your QFEX API key in the setup window.");
    return session;
  }

  async function setLeverage(session: QfexSession, market: VenueMarket, leverage: number | undefined) {
    if (!leverage) return;
    const value = Math.max(1, Math.min(market.maxLeverage, Math.round(leverage)));
    const key = `${session.publicKey}:${market.coin}`;
    if (lastLeverage.get(key) === value) return;
    await qfexSocket(session).request({ type: "set_user_leverage", params: { symbol: market.coin, leverage: value } }, (reply) =>
      "ack_response" in reply || "user_leverage_response" in reply ? true : undefined,
    );
    lastLeverage.set(key, value);
  }

  const clientId = () => crypto.randomUUID();

  /**
   * Sends an order and follows it to an outcome: filled (with the size and average price from the `fills` stream),
   * resting (limits), or a readable error for any rejection status.
   */
  async function submit(session: QfexSession, params: Record<string, unknown>, kind: PlaceOrderInput["kind"], takerFee: number): Promise<OrderResult> {
    const socket = qfexSocket(session);
    const id = clientId();
    let orderId: string | null = null;
    const fills: FillResponse[] = [];
    // Ours by client order id; should QFEX not echo it, by order id once known, else the first answer for this
    // symbol, side and size (so an unechoed id can't leave a placed order reported as unanswered).
    const isOurs = (response: OrderResponse) => {
      if (response.client_order_id) return response.client_order_id === id;
      if (orderId) return response.order_id === orderId;
      return response.symbol === params.symbol && response.side === params.side && Math.abs((response.quantity ?? 0) - Number(params.quantity)) < 1e-9;
    };
    const stopFills = socket.listen((message) => {
      const fill = message.fill_response as FillResponse | undefined;
      if (fill && orderId && fill.order_id === orderId) fills.push(fill);
    });
    try {
      const outcome = await socket.request<{ status: string; response: OrderResponse }>(
        { type: "add_order", params: { ...params, client_order_id: id } },
        (reply: QfexMessage) => {
          const response = reply.order_response as OrderResponse | undefined;
          if (!response || !isOurs(response)) return undefined;
          if (response.order_id) orderId = response.order_id;
          const status = response.status ?? "";
          if (isFailure(status)) return { status, response };
          // Market orders end filled or cancelled; a limit's ACK means it rests unless a fill follows at once.
          if (status === "FILLED" && (response.quantity_remaining ?? 0) <= 0) return { status, response };
          if (status === "IOC_PARTIALLY_FILLED" || status === "IOC_CANCELLED") return { status, response };
          if (kind === "limit" && status === "ACK") return { status, response };
          return undefined;
        },
      );
      if (isFailure(outcome.status)) throw new VenueError(qfexStatusMessage(outcome.status), outcome.status);
      if (kind === "limit" && outcome.status === "ACK") {
        await new Promise((resolve) => setTimeout(resolve, LIMIT_SETTLE_MS));
        notifyOrders();
        if (fills.length === 0) return { status: "resting", oid: oidOf(outcome.response.order_id ?? id) };
      }
      if (fills.length === 0) await new Promise((resolve) => setTimeout(resolve, FILL_GRACE_MS));
      const filled = fills.reduce((sum, fill) => sum + (fill.quantity ?? 0), 0);
      if (!(filled > 0) && TERMINAL_FAILURES.has(outcome.status)) throw new VenueError(qfexStatusMessage(outcome.status), outcome.status);
      const size = filled > 0 ? filled : (outcome.response.quantity ?? 0) - (outcome.response.quantity_remaining ?? 0);
      const avgPx = filled > 0 ? fills.reduce((sum, fill) => sum + (fill.price ?? 0) * (fill.quantity ?? 0), 0) / filled : (outcome.response.price ?? 0);
      notifyOrders();
      return { status: "filled", oid: oidOf(outcome.response.order_id ?? id), filledSize: size, avgPx, partnerFeeBps: qfexConfig.builderCode ? takerFee * qfexConfig.builderShare * 10_000 : 0 };
    } finally {
      stopFills();
    }
  }

  async function placeOrder(user: `0x${string}`, input: PlaceOrderInput): Promise<OrderResult> {
    const { market } = input;
    const session = await requireSession(user);
    const info = await infoOf(market.coin);
    const quantity = roundToStep(input.size, info.lot, "down");
    if (!(quantity > 0) || (!input.reduceOnly && quantity < info.minQuantity)) throw new VenueError(`Size is below ${market.symbol}'s minimum on QFEX (${info.minQuantity}).`);
    if (quantity > info.maxQuantity) throw new VenueError(`Size is above ${market.symbol}'s maximum on QFEX (${info.maxQuantity}).`);
    if (!input.reduceOnly) await setLeverage(session, market, input.leverage);
    const limit = input.kind === "limit" && input.limitPx;
    // TP/SL on the whole entry ride on the order itself; a partial TP/SL follows the fill (the provider sends it).
    const attach = !input.reduceOnly && input.tpslSize === undefined;
    const params: Record<string, unknown> = {
      symbol: market.coin,
      side: input.side === "buy" ? "BUY" : "SELL",
      order_type: limit ? "LIMIT" : "MARKET",
      order_time_in_force: limit ? "GTC" : "IOC",
      quantity,
      ...(limit ? { price: roundToStep(input.limitPx!, info.tick) } : {}),
      take_profit: attach && input.takeProfit ? roundToStep(input.takeProfit, info.tick) : 0,
      stop_loss: attach && input.stopLoss ? roundToStep(input.stopLoss, info.tick) : 0,
      reduce_only: input.reduceOnly ? 1 : 0,
    };
    return submit(session, params, input.kind, market.takerFee ?? 0);
  }

  async function cancelOrder(user: `0x${string}`, order: Pick<VenueOpenOrder, "coin" | "oid">) {
    const session = await requireSession(user);
    const known = orderIds.get(order.oid);
    if (!known) throw new VenueError("This QFEX order isn't known here anymore. Refresh and try again.");
    const socket = qfexSocket(session);
    if (known.stop) {
      await socket.request({ type: "cancel_stop_order", params: { stop_order_id: known.id } }, (reply) => {
        const response = (reply.stop_order_response ?? reply.order_response) as { stop_order_id?: string; order_id?: string } | undefined;
        return response && (response.stop_order_id === known.id || response.order_id === known.id) ? true : undefined;
      });
      stops.delete(known.id);
    } else {
      const status = await socket.request({ type: "cancel_order", params: { order_id: known.id, symbol: known.symbol, cancel_order_id_type: "order_id" } }, (reply) => {
        const response = reply.order_response as OrderResponse | undefined;
        return response?.order_id === known.id ? (response.status ?? "") : undefined;
      });
      if (status !== "CANCELLED" && isFailure(status)) throw new VenueError(qfexStatusMessage(status), status);
    }
    notifyOrders();
  }

  async function marketOf(position: PositionRef) {
    const market = (await listMarkets()).find((entry) => entry.coin === position.coin);
    if (!market) throw new VenueError(`QFEX doesn't list ${position.symbol} anymore.`);
    return market;
  }

  async function closePosition(user: `0x${string}`, position: PositionRef, size?: number): Promise<OrderResult> {
    const market = await marketOf(position);
    const amount = Math.min(size ?? Infinity, Math.abs(position.size));
    return placeOrder(user, { market, side: position.size > 0 ? "sell" : "buy", kind: "market", size: amount, reduceOnly: true });
  }

  /** TP/SL on an open position: one stop order per level on the closing side (market when triggered), for `size` or all of it. */
  async function setPositionTpsl(user: `0x${string}`, position: PositionRef, levels: PositionTpsl) {
    if (!levels.takeProfit && !levels.stopLoss) return;
    const session = await requireSession(user);
    const market = await marketOf(position);
    const info = await infoOf(market.coin);
    const quantity = roundToStep(Math.min(levels.size ?? Infinity, Math.abs(position.size)), info.lot, "down");
    if (!(quantity > 0)) throw new VenueError(`TP/SL size is below ${market.symbol}'s step on QFEX (${info.lot}).`);
    const side = position.size > 0 ? "SELL" : "BUY";
    const socket = qfexSocket(session);
    const place = async (type: "TAKE_PROFIT" | "STOP_LOSS", trigger: number) => {
      const id = clientId();
      const price = roundToStep(trigger, info.tick);
      const response = await socket.request(
        { type: "add_order", params: { symbol: market.coin, side, order_type: type, order_time_in_force: "GTC", quantity, price, client_order_id: id } },
        (reply) => {
          const stop = reply.stop_order_response as StopResponse | undefined;
          if (stop && (stop.client_order_id === id || (!stop.client_order_id && stop.symbol === market.coin))) return { id: stop.stop_order_id ?? id, status: "ACK" };
          const order = reply.order_response as OrderResponse | undefined;
          if (order?.client_order_id === id) return { id: order.order_id ?? id, status: order.status ?? "" };
          return undefined;
        },
      );
      if (isFailure(response.status)) throw new VenueError(qfexStatusMessage(response.status), response.status);
      stops.set(response.id, { id: response.id, symbol: market.coin, side, type, price, quantity, remaining: quantity, time: Date.now(), stop: true });
    };
    if (levels.takeProfit) await place("TAKE_PROFIT", levels.takeProfit);
    if (levels.stopLoss) await place("STOP_LOSS", levels.stopLoss);
    notifyOrders();
  }

  function notifyOrders() {
    ordersChanged.forEach((listener) => listener());
  }

  /** Open orders from `get_user_orders` (live statuses only), plus the stop orders placed from this tab. */
  async function readOrders(session: QfexSession): Promise<QfexOrderRow[]> {
    const rows = await qfexSocket(session).request({ type: "get_user_orders", params: { limit: 100, offset: 0 } }, (reply) => {
      const all = reply.all_orders_response as { orders?: OrderResponse[] } | undefined;
      return all ? (all.orders ?? []) : undefined;
    });
    const live = rows.flatMap((row): QfexOrderRow[] => {
      if (!row.order_id || !row.symbol || !QFEX_LIVE_STATUSES.has(row.status ?? "")) return [];
      const stop = row.type === "TAKE_PROFIT" || row.type === "STOP_LOSS";
      return [
        {
          id: row.order_id,
          symbol: row.symbol,
          side: row.side === "SELL" ? "SELL" : "BUY",
          type: row.type ?? "LIMIT",
          price: row.price ?? 0,
          quantity: row.quantity ?? 0,
          remaining: row.quantity_remaining ?? row.quantity ?? 0,
          time: Math.round((row.update_time ?? 0) * 1000),
          stop,
        },
      ];
    });
    const listed = new Set(live.map((row) => row.id));
    return [...live, ...[...stops.values()].filter((row) => !listed.has(row.id))];
  }

  /**
   * The account: the signed REST snapshot (positions and balance) at start and every 15s, the `positions` and `balances`
   * streams in between, and open orders re-read whenever an order event arrives.
   */
  function subscribeAccount(user: `0x${string}`, handlers: AccountHandlers) {
    let active = true;
    let timer: number | undefined;
    let stopListening = () => {};
    const positions = new Map<string, QfexPositionRow>();
    let balance: QfexBalance | null = null;
    let orders: QfexOrderRow[] = [];
    const empty: AccountSnapshot = { positions: [], orders: [], accountValue: 0, withdrawable: 0 };

    const emit = async () => {
      const markets = await listMarkets().catch(() => [] as VenueMarket[]);
      for (const order of orders) orderIds.set(oidOf(order.id), { id: order.id, symbol: order.symbol, stop: order.stop });
      if (active) handlers.onSnapshot(readQfexAccount(markets, [...positions.values()], orders, balance));
    };

    const start = async () => {
      const pending = qfexSession(user);
      if (!pending) return handlers.onSnapshot(empty);
      const session = await pending.catch(() => null);
      if (!session || !active) return;
      const socket = qfexSocket(session);

      const snapshot = async () => {
        try {
          const body = await qfexApi<{ balance?: QfexBalance; positions?: QfexPositionRow[] | null }>("/user/positions", session);
          positions.clear();
          for (const row of body.positions ?? []) positions.set(row.symbol, row);
          balance = body.balance ?? balance;
          await emit();
        } catch (error) {
          if (active) handlers.onError?.(error);
        }
      };
      let reading = false;
      const refreshOrders = async () => {
        if (reading) return;
        reading = true;
        try {
          orders = await readOrders(session);
          await emit();
        } catch (error) {
          if (active) handlers.onError?.(error);
        } finally {
          reading = false;
        }
      };
      ordersChanged.add(refreshOrders);

      stopListening = socket.listen((message) => {
        const position = message.position_response as QfexPositionRow | undefined;
        if (position?.symbol) {
          positions.set(position.symbol, position);
          void emit();
        }
        const next = message.balance_response as QfexBalance | undefined;
        if (next) {
          balance = { ...balance, ...next };
          void emit();
        }
        if (message.order_response || message.stop_order_response || message.fill_response) void refreshOrders();
      });
      const previous = stopListening;
      stopListening = () => {
        previous();
        ordersChanged.delete(refreshOrders);
      };
      await snapshot();
      await socket.connect().then(refreshOrders, (error) => active && handlers.onError?.(error));
      timer = window.setInterval(() => {
        if (document.visibilityState === "hidden") return;
        void snapshot();
        void refreshOrders();
      }, POLL_MS);
    };

    void start();
    return () => {
      active = false;
      window.clearInterval(timer);
      stopListening();
    };
  }

  async function loadCandles(market: VenueMarket, interval: string, startTime: number): Promise<Candle[]> {
    const resolution = QFEX_INTERVALS[interval];
    if (!resolution) throw new VenueError(`QFEX has no ${interval} candles.`);
    const from = new Date(startTime).toISOString();
    const to = new Date().toISOString();
    const body = await qfexApi<unknown>(`/candles/${encodeURIComponent(market.coin)}?resolution=${resolution}&fromISO=${encodeURIComponent(from)}&toISO=${encodeURIComponent(to)}`);
    return readQfexCandles(body);
  }

  return {
    kind: "perp",
    id: "qfex",
    name: "QFEX",
    network: "mainnet",
    listMarkets,
    resolveMarket: async (symbol) => (await listMarkets()).find((market) => market.symbol.toUpperCase() === symbol.toUpperCase()) ?? null,
    placeOrder,
    cancelOrder,
    closePosition,
    setPositionTpsl,
    subscribeAccount,
    loadCandles,
  };
}

export const qfexVenue = createQfexVenue();

/** Checks a pasted key pair by authenticating a Trade WebSocket with it (and reading the account once). */
export async function verifyQfexKey(session: QfexSession) {
  const { QfexTradeSocket } = await import("./trade-socket");
  const probe = new QfexTradeSocket(session);
  try {
    await probe.connect();
  } finally {
    probe.close();
  }
  await qfexApi("/user/positions", session);
}
