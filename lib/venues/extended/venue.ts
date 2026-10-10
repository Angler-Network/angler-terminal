"use client";

import { VenueError, type AccountHandlers, type AccountSnapshot, type Candle, type OrderResult, type PerpVenue, type PlaceOrderInput, type PositionRef, type PositionTpsl, type VenueMarket, type VenueOpenOrder } from "../types";
import { applyAccountMessage, emptyAccountState, type ExtendedAccountState } from "./account-stream";
import { marketOrderPrice, numberText, roundToStep, settlementAmounts, settlementExpiration } from "./amounts";
import { extendedApi, extendedApiOrNull } from "./api";
import { extendedConfig } from "./config";
import {
  EXTENDED_INTERVALS,
  oidOf,
  readExtendedAccount,
  readExtendedCandles,
  readExtendedMarkets,
  type ExtendedBalance,
  type ExtendedMarketInfo,
  type ExtendedMarketRow,
  type ExtendedOrderRow,
  type ExtendedPositionRow,
} from "./markets";
import { extendedSession, type ExtendedSession } from "./store";

/**
 * Extended perps as a terminal venue. Market data and orders go through our proxy (no CORS on Extended's REST API);
 * the account streams over Extended's WebSocket straight from the browser (the API key rides in the subscribe message),
 * with slow REST polling as the fallback. Every order carries our builder id and fee on mainnet, inside the Stark-signed
 * max fee.
 */

const MARKETS_TTL_MS = 60_000;
const FEES_TTL_MS = 10 * 60_000;
const POLL_MS = 10_000;
const CONFIRM_TIMEOUT_MS = 8_000;
const CONFIRM_INTERVAL_MS = 500;
const MARKET_EXPIRY_MS = 60 * 60_000;
/** Testnet takes limit orders up to 28 days, mainnet 90: 28 works on both. */
const LIMIT_EXPIRY_MS = 28 * 86_400_000;
/** Worst price for a TP/SL's market execution, away from its trigger. */
const TPSL_SLIPPAGE = 0.05;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const randomNonce = () => 1 + Math.floor(Math.random() * (2 ** 31 - 2));

interface FeeRates {
  taker: string;
  /** Our builder fee on this account and market (0 without a builder id), capped at what Extended allows. */
  builder: string;
}

function createExtendedVenue(): PerpVenue {
  let cache: { at: number; data: Promise<{ markets: VenueMarket[]; info: Map<string, ExtendedMarketInfo> }> } | null = null;
  const fees = new Map<string, { at: number; rates: Promise<FeeRates> }>();
  /** Open orders' external ids by the terminal's `oid` (Extended's own ids pass 2^53). */
  const externalIds = new Map<number, string>();
  const lastLeverage = new Map<string, number>();

  function loadMarkets() {
    if (!cache || Date.now() - cache.at > MARKETS_TTL_MS) {
      const data = fetch(`${extendedConfig.proxy}/markets?network=${extendedConfig.network}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new VenueError(`Extended markets answered ${response.status}.`);
          return readExtendedMarkets(((await response.json()) as { markets?: ExtendedMarketRow[] }).markets ?? []);
        });
      cache = { at: Date.now(), data };
      data.catch(() => (cache = null));
    }
    return cache.data;
  }

  const listMarkets = async () => (await loadMarkets()).markets;

  async function infoOf(coin: string) {
    const info = (await loadMarkets()).info.get(coin);
    if (!info) throw new VenueError(`Extended doesn't list ${coin}.`);
    return info;
  }

  async function requireSession(user: string): Promise<ExtendedSession> {
    const session = extendedSession(user);
    if (!session) throw new VenueError("Set up Extended trading first: sign in with this wallet in the setup window.");
    return session;
  }

  function feeRates(session: ExtendedSession, market: string): Promise<FeeRates> {
    const key = `${session.accountId}:${market}`;
    const cached = fees.get(key);
    if (cached && Date.now() - cached.at < FEES_TTL_MS) return cached.rates;
    const builderId = extendedConfig.builderId;
    const rates = extendedApi<Array<{ takerFeeRate?: string; builderFeeRate?: string }>>(
      `/api/v1/user/fees?market=${encodeURIComponent(market)}${builderId ? `&builderId=${builderId}` : ""}`,
      { apiKey: session.apiKey },
    ).then((rows) => {
      const row = rows?.[0] ?? {};
      const taker = row.takerFeeRate ?? "0.00025";
      const cap = Number(row.builderFeeRate ?? 0);
      const builder = builderId ? Math.min(extendedConfig.builderFee, cap > 0 ? cap : extendedConfig.builderFee) : 0;
      return { taker, builder: numberText(Number(builder.toFixed(6))) };
    });
    rates.catch(() => fees.delete(key));
    fees.set(key, { at: Date.now(), rates });
    return rates;
  }

  async function setLeverage(session: ExtendedSession, market: VenueMarket, leverage: number | undefined) {
    if (!leverage) return;
    const value = Math.max(1, Math.min(market.maxLeverage, Math.round(leverage)));
    const key = `${session.accountId}:${market.coin}`;
    if (lastLeverage.get(key) === value) return;
    await extendedApi("/api/v1/user/leverage", { method: "PATCH", apiKey: session.apiKey, body: { market: market.coin, leverage: String(value) } });
    lastLeverage.set(key, value);
  }

  /** The Stark settlement of an order (or a TP/SL leg): amounts, hash and signature, as the SDK builds them. */
  async function settle(session: ExtendedSession, info: ExtendedMarketInfo, side: "buy" | "sell", qty: string, price: string, rates: FeeRates, expiryMs: number) {
    const amounts = settlementAmounts({
      side,
      qty,
      price,
      takerFee: rates.taker,
      builderFee: rates.builder,
      syntheticResolution: info.syntheticResolution,
      collateralResolution: info.collateralResolution,
    });
    const nonce = randomNonce();
    const { orderHash, signStark } = await import("./signer");
    const hash = await orderHash({
      vault: session.vault,
      syntheticId: info.syntheticId,
      synthetic: amounts.synthetic,
      collateralId: info.collateralId,
      collateral: amounts.collateral,
      fee: amounts.fee,
      expiration: settlementExpiration(expiryMs),
      nonce,
      publicKey: session.publicKey,
    });
    const signature = await signStark(session.starkKey, hash);
    return { hash, nonce, settlement: { signature, starkKey: session.publicKey, collateralPosition: session.vault } };
  }

  /** Best bid and ask from the book (the market list's prices can be a minute old). */
  async function touch(market: VenueMarket) {
    const book = await extendedApi<{ bid?: Array<{ price: string }>; ask?: Array<{ price: string }> }>(`/api/v1/info/markets/${encodeURIComponent(market.coin)}/orderbook`).catch(() => null);
    const bid = Number(book?.bid?.[0]?.price) || market.midPx || market.markPx || 0;
    const ask = Number(book?.ask?.[0]?.price) || market.midPx || market.markPx || 0;
    return { bid, ask, mid: bid && ask ? (bid + ask) / 2 : market.markPx ?? 0 };
  }

  /** TP/SL legs (market when triggered by the mark price), each Stark-signed for `qty` on the closing side. */
  async function tpslLegs(session: ExtendedSession, info: ExtendedMarketInfo, closeSide: "buy" | "sell", qty: (price: string) => string, levels: Pick<PositionTpsl, "takeProfit" | "stopLoss">, rates: FeeRates, expiryMs: number) {
    const leg = async (trigger: number | undefined) => {
      if (!trigger) return undefined;
      const worst = marketOrderPrice({ side: closeSide, reference: trigger, mark: trigger, tick: info.tick, cap: TPSL_SLIPPAGE, floor: TPSL_SLIPPAGE, slippage: TPSL_SLIPPAGE });
      const signed = await settle(session, info, closeSide, qty(worst), worst, rates, expiryMs);
      return { triggerPrice: roundToStep(trigger, info.tick), triggerPriceType: "MARK", price: worst, priceType: "MARKET", settlement: signed.settlement };
    };
    return { takeProfit: await leg(levels.takeProfit), stopLoss: await leg(levels.stopLoss) };
  }

  /** The order's outcome, read back by its external id: market orders fill or not at once. */
  async function confirm(session: ExtendedSession, externalId: string, kind: PlaceOrderInput["kind"], builderFee: string): Promise<OrderResult> {
    const oid = oidOf(externalId);
    externalIds.set(oid, externalId);
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(CONFIRM_INTERVAL_MS);
      const found = await extendedApiOrNull<ExtendedOrderRow | ExtendedOrderRow[]>(`/api/v1/user/orders/external/${externalId}`, { apiKey: session.apiKey }).catch(() => null);
      const order = Array.isArray(found) ? found[0] : found;
      if (!order) continue;
      const filled = Number(order.filledQty ?? 0);
      if (order.status === "FILLED" || (kind === "market" && filled > 0 && order.status !== "NEW" && order.status !== "PARTIALLY_FILLED")) {
        return { status: "filled", oid, filledSize: filled, avgPx: Number(order.averagePrice ?? order.price ?? 0), partnerFeeBps: Number(builderFee) * 10_000 };
      }
      if (order.status === "REJECTED" || order.status === "CANCELLED" || order.status === "EXPIRED") {
        const reason = (order as { statusReason?: string }).statusReason;
        throw new VenueError(`Extended ${order.status === "REJECTED" ? "rejected" : "canceled"} the order${reason ? ` (${reason.replace(/_/g, " ").toLowerCase()})` : ""}.`, reason);
      }
      if (kind === "limit" && (order.status === "NEW" || order.status === "PARTIALLY_FILLED")) return { status: "resting", oid };
    }
    if (kind === "limit") return { status: "resting", oid };
    throw new VenueError("Extended accepted the order but hasn't confirmed the fill yet. Check your positions before trying again.");
  }

  async function placeOrder(user: `0x${string}`, input: PlaceOrderInput): Promise<OrderResult> {
    const { market } = input;
    const session = await requireSession(user);
    const info = await infoOf(market.coin);
    const qty = roundToStep(input.size, info.sizeStep, "down");
    if (!(Number(qty) > 0) || (!input.reduceOnly && Number(qty) < Number(info.minOrderSize))) {
      throw new VenueError(`Size is below ${market.symbol}'s minimum on Extended (${info.minOrderSize}).`);
    }
    if (!input.reduceOnly) await setLeverage(session, market, input.leverage);
    const rates = await feeRates(session, market.coin);
    const limit = input.kind === "limit" && input.limitPx;
    let price: string;
    if (limit) price = roundToStep(input.limitPx!, info.tick);
    else {
      const { bid, ask, mid } = await touch(market);
      price = marketOrderPrice({ side: input.side, reference: input.side === "buy" ? ask : bid, mark: market.markPx ?? mid, tick: info.tick, cap: info.priceCap, floor: info.priceFloor });
    }
    const expiryMs = Date.now() + (limit ? LIMIT_EXPIRY_MS : MARKET_EXPIRY_MS);
    const main = await settle(session, info, input.side, qty, price, rates, expiryMs);
    const closeSide = input.side === "buy" ? "sell" : "buy";
    const withTpsl = Boolean(input.takeProfit || input.stopLoss) && !input.reduceOnly;
    // TP/SL ride on the entry ("ORDER": they cover this order's size), each signed for the entry's quantity.
    const tpsl = withTpsl ? await tpslLegs(session, info, closeSide, () => qty, { takeProfit: input.takeProfit, stopLoss: input.stopLoss }, rates, expiryMs) : null;
    const externalId = BigInt(main.hash).toString();
    await extendedApi("/api/v1/user/order", {
      method: "POST",
      apiKey: session.apiKey,
      body: {
        id: externalId,
        market: market.coin,
        type: limit ? "LIMIT" : "MARKET",
        side: input.side === "buy" ? "BUY" : "SELL",
        qty,
        price,
        timeInForce: limit ? "GTT" : "IOC",
        expiryEpochMillis: expiryMs,
        fee: rates.taker,
        nonce: String(main.nonce),
        selfTradeProtectionLevel: "ACCOUNT",
        reduceOnly: Boolean(input.reduceOnly),
        postOnly: false,
        settlement: main.settlement,
        ...(tpsl ? { tpSlType: "ORDER", ...(tpsl.takeProfit ? { takeProfit: tpsl.takeProfit } : {}), ...(tpsl.stopLoss ? { stopLoss: tpsl.stopLoss } : {}) } : {}),
        ...(extendedConfig.builderId && Number(rates.builder) > 0 ? { builderId: extendedConfig.builderId, builderFee: rates.builder } : {}),
      },
    });
    return confirm(session, externalId, input.kind, extendedConfig.builderId ? rates.builder : "0");
  }

  async function cancelOrder(user: `0x${string}`, order: Pick<VenueOpenOrder, "coin" | "oid">) {
    const session = await requireSession(user);
    const externalId = externalIds.get(order.oid);
    if (!externalId) throw new VenueError("This Extended order isn't known here anymore. Refresh and try again.");
    await extendedApi(`/api/v1/user/order?externalId=${encodeURIComponent(externalId)}`, { method: "DELETE", apiKey: session.apiKey });
  }

  async function marketOf(position: PositionRef) {
    const market = (await listMarkets()).find((entry) => entry.coin === position.coin);
    if (!market) throw new VenueError(`Extended doesn't list ${position.symbol} anymore.`);
    return market;
  }

  async function closePosition(user: `0x${string}`, position: PositionRef, size?: number): Promise<OrderResult> {
    const market = await marketOf(position);
    const amount = Math.min(size ?? Infinity, Math.abs(position.size));
    return placeOrder(user, { market, side: position.size > 0 ? "sell" : "buy", kind: "market", size: amount, reduceOnly: true });
  }

  /**
   * TP/SL on an open position: a standalone `TPSL` order. On the whole position ("POSITION") each leg is signed for the
   * largest size the position could reach (Extended's rule, so the trigger always covers it); for part of it ("ORDER")
   * for that size.
   */
  async function setPositionTpsl(user: `0x${string}`, position: PositionRef, levels: PositionTpsl) {
    if (!levels.takeProfit && !levels.stopLoss) return;
    const session = await requireSession(user);
    const market = await marketOf(position);
    const info = await infoOf(market.coin);
    const rates = await feeRates(session, market.coin);
    const partial = levels.size !== undefined && levels.size < Math.abs(position.size);
    const size = partial ? roundToStep(levels.size!, info.sizeStep, "down") : null;
    if (size !== null && !(Number(size) > 0)) throw new VenueError(`TP/SL size is below ${market.symbol}'s step on Extended (${info.sizeStep}).`);
    const closeSide = position.size > 0 ? "sell" : "buy";
    const expiryMs = Date.now() + LIMIT_EXPIRY_MS;
    const entire = (price: string) => roundToStep((Number(info.maxPositionValue) * 50) / Number(price), info.sizeStep, "down");
    const legs = await tpslLegs(session, info, closeSide, (price) => size ?? entire(price), levels, rates, expiryMs);
    const id = BigInt(`0x${[...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`).toString();
    await extendedApi("/api/v1/user/order", {
      method: "POST",
      apiKey: session.apiKey,
      body: {
        id,
        market: market.coin,
        type: "TPSL",
        side: closeSide === "buy" ? "BUY" : "SELL",
        qty: size ?? "0",
        price: "0",
        timeInForce: "GTT",
        expiryEpochMillis: expiryMs,
        fee: rates.taker,
        nonce: String(randomNonce()),
        selfTradeProtectionLevel: "ACCOUNT",
        reduceOnly: true,
        postOnly: false,
        tpSlType: partial ? "ORDER" : "POSITION",
        ...(legs.takeProfit ? { takeProfit: legs.takeProfit } : {}),
        ...(legs.stopLoss ? { stopLoss: legs.stopLoss } : {}),
        ...(extendedConfig.builderId && Number(rates.builder) > 0 ? { builderId: extendedConfig.builderId, builderFee: rates.builder } : {}),
      },
    });
  }

  /**
   * The account over Extended's WebSocket (v2 JSON-RPC, the API key in the subscribe message), each change merged into
   * the last snapshot; when the socket can't open, REST polling through the proxy every 10s instead.
   */
  function subscribeAccount(user: `0x${string}`, handlers: AccountHandlers) {
    let active = true;
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    let state: ExtendedAccountState = emptyAccountState();
    const empty: AccountSnapshot = { positions: [], orders: [], accountValue: 0, withdrawable: 0 };

    const emit = async (positions: ExtendedPositionRow[], orders: ExtendedOrderRow[], balance: ExtendedBalance | null) => {
      const markets = await listMarkets().catch(() => [] as VenueMarket[]);
      for (const order of orders) {
        const externalId = order.externalId ?? String(order.id);
        externalIds.set(oidOf(externalId), externalId);
      }
      if (active) handlers.onSnapshot(readExtendedAccount(markets, positions, orders, balance));
    };

    const poll = (session: ExtendedSession) => {
      const read = async () => {
        try {
          const [positions, orders, balance] = await Promise.all([
            extendedApi<ExtendedPositionRow[]>("/api/v1/user/positions", { apiKey: session.apiKey }),
            extendedApi<ExtendedOrderRow[]>("/api/v1/user/orders", { apiKey: session.apiKey }),
            extendedApiOrNull<ExtendedBalance>("/api/v1/user/balance", { apiKey: session.apiKey }),
          ]);
          await emit(positions ?? [], orders ?? [], balance);
        } catch (error) {
          if (active) handlers.onError?.(error);
        }
      };
      void read();
      timer = window.setInterval(() => document.visibilityState !== "hidden" && void read(), POLL_MS);
    };

    const start = async () => {
      const pending = extendedSession(user);
      if (!pending) return handlers.onSnapshot(empty);
      const session = await pending.catch(() => null);
      if (!session || !active) return;
      let opened = false;
      try {
        socket = new WebSocket(`${extendedConfig.ws}/v2/rpc`);
      } catch {
        return poll(session);
      }
      socket.onopen = () => {
        opened = true;
        socket?.send(JSON.stringify({ jsonrpc: "2.0", id: "1", method: "subscribe", params: { scope: "account", selector: { account: String(session.accountId) }, apiKey: session.apiKey } }));
      };
      socket.onmessage = (event) => {
        let message: { type?: string; data?: Record<string, unknown>; error?: unknown } | null = null;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!message?.type) {
          // The subscribe call's answer: an error means the stream won't come, so poll instead.
          if (message?.error) {
            socket?.close();
            if (active && !timer) poll(session);
          }
          return;
        }
        state = applyAccountMessage(state, message);
        void emit([...state.positions.values()], [...state.orders.values()], state.balance);
      };
      socket.onclose = () => {
        if (!active || timer) return;
        // Never opened: polling for good. Opened and dropped: reconnect after a pause.
        if (!opened) poll(session);
        else window.setTimeout(() => active && !timer && void start(), 3_000);
      };
    };

    void start();
    return () => {
      active = false;
      window.clearInterval(timer);
      socket?.close();
    };
  }

  async function loadCandles(market: VenueMarket, interval: string, startTime: number): Promise<Candle[]> {
    const period = EXTENDED_INTERVALS[interval];
    if (!period) throw new VenueError(`Extended has no ${interval} candles.`);
    const minutes: Record<string, number> = { PT1M: 1, PT5M: 5, PT15M: 15, PT30M: 30, PT1H: 60, PT2H: 120, PT4H: 240, PT8H: 480, PT12H: 720, P1D: 1440, P7D: 10_080, P30D: 43_200 };
    const limit = Math.min(1000, Math.max(2, Math.ceil((Date.now() - startTime) / (minutes[period] * 60_000)) + 1));
    const rows = await extendedApi<Array<{ o?: string; h?: string; l?: string; c?: string; v?: string; T?: number }>>(
      `/api/v1/info/candles/${encodeURIComponent(market.coin)}/trades?interval=${period}&limit=${limit}`,
    );
    return readExtendedCandles(rows ?? []).filter((candle) => candle.time >= startTime - minutes[period] * 60_000);
  }

  return {
    kind: "perp",
    id: "extended",
    name: "Extended",
    network: extendedConfig.network,
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

export const extendedVenue = createExtendedVenue();
