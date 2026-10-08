"use client";

import { vipFee } from "@/lib/profile/vip";
import { VenueError, type AccountHandlers, type Candle, type OrderResult, type PerpVenue, type PlaceOrderInput, type PositionRef, type PositionTpsl, type VenueMarket, type VenueOpenOrder } from "../types";
import { asterConfig } from "./config";
import { readAsterAccount, readAsterCandles, readAsterMarkets, type AsterAccountInfo, type AsterOrderRow, type AsterPositionRow } from "./markets";
import { asterOnboarding, readAsterRecord } from "./store";
import { signAgentRequest, type AsterParams } from "./sign";

/**
 * Aster perps as a terminal venue. Public data straight from fapi.asterdex.com (it allows browser requests); orders and
 * account reads signed in this browser by the wallet's agent key, with our builder fee on every order.
 */

const POLL_MS = 3_000;
const MARKETS_TTL_MS = 60_000;
const CANDLE_INTERVALS = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"]);

async function publicGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
  const response = await fetch(`${asterConfig.apiUrl}${path}${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new VenueError(`Aster answered ${response.status}.`);
  return (await response.json()) as T;
}

async function agentFor(user: `0x${string}`) {
  // viem's accounts (secp256k1) load with the first signed request, not with the page.
  const { asterAgent } = await import("./onboarding");
  const agent = asterAgent(user);
  if (!agent) throw new VenueError("Set up Aster trading first: approve a trading key from this wallet.");
  return agent;
}

/** A request signed by the agent: query string for GET, form body otherwise (as Aster's docs ask). */
async function signed<T>(user: `0x${string}`, method: "GET" | "POST" | "DELETE", path: string, params: AsterParams = {}): Promise<T> {
  const query = await signAgentRequest(await agentFor(user), user, params);
  const url = `${asterConfig.apiUrl}${path}`;
  const response =
    method === "GET"
      ? await fetch(`${url}?${query}`, { cache: "no-store" })
      : await fetch(url, { method, cache: "no-store", headers: { "content-type": "application/x-www-form-urlencoded" }, body: query });
  const body = (await response.json().catch(() => ({}))) as T & { code?: number; msg?: string };
  if (!response.ok || (typeof body?.code === "number" && body.code < 0)) {
    throw new VenueError(body?.msg ? `Aster: ${body.msg}` : `Aster answered ${response.status}.`, body?.code !== undefined ? String(body.code) : undefined);
  }
  return body;
}

const fixed = (value: number, decimals: number) => value.toFixed(Math.max(0, decimals)).replace(/\.?0+$/, "") || "0";

/** Our fee on this order (the builder's rate at the wallet's VIP tier), or nothing when the wallet hasn't approved it. */
function builderFields(user: string): AsterParams {
  const builder = asterConfig.builder;
  if (!builder || asterOnboarding(user).builder !== "approved") return {};
  // Rates in millionths so the VIP tier rounds like the other venues' integer fees.
  const rate = vipFee(Math.round(builder.feeRate * 1_000_000)) / 1_000_000;
  return { builder: builder.address, feeRate: String(rate) };
}

interface AsterOrderResponse {
  orderId: number;
  status?: string;
  executedQty?: string;
  avgPrice?: string;
}

function toResult(order: AsterOrderResponse, feeRate: number): OrderResult {
  const filled = Number(order.executedQty);
  if (filled > 0 && order.status !== "NEW") return { status: "filled", oid: order.orderId, filledSize: filled, avgPx: Number(order.avgPrice) || 0, partnerFeeBps: feeRate * 10_000 };
  return { status: "resting", oid: order.orderId };
}

/** The leverage and margin mode last set per symbol in this session, so they're only sent when they change. */
const lastSettings = new Map<string, { leverage?: number; isCross?: boolean }>();

async function applySettings(user: `0x${string}`, market: VenueMarket, input: PlaceOrderInput) {
  const key = `${user}:${market.coin}`;
  const last = lastSettings.get(key) ?? {};
  if (input.isCross !== undefined && input.isCross !== last.isCross) {
    await signed(user, "POST", "/fapi/v3/marginType", { symbol: market.coin, marginType: input.isCross ? "CROSSED" : "ISOLATED" }).catch((error: unknown) => {
      // -4046: already in that mode. Anything else (open position in the other mode) surfaces.
      if (!(error instanceof VenueError) || error.raw !== "-4046") throw error;
    });
    last.isCross = input.isCross;
  }
  if (input.leverage && input.leverage !== last.leverage) {
    await signed(user, "POST", "/fapi/v3/leverage", { symbol: market.coin, leverage: Math.round(Math.min(input.leverage, market.maxLeverage)) });
    last.leverage = input.leverage;
  }
  lastSettings.set(key, last);
}

/** Trigger orders closing the whole position, or `levels.size` of it as reduce-only orders of that quantity. */
async function placeTriggers(user: `0x${string}`, market: VenueMarket, closeSide: "BUY" | "SELL", levels: PositionTpsl) {
  const decimals = market.priceDecimals ?? 2;
  for (const [type, price] of [
    ["TAKE_PROFIT_MARKET", levels.takeProfit],
    ["STOP_MARKET", levels.stopLoss],
  ] as const) {
    if (!price) continue;
    await signed(user, "POST", "/fapi/v3/order", {
      symbol: market.coin,
      side: closeSide,
      type,
      stopPrice: fixed(price, decimals),
      ...(levels.size === undefined ? { closePosition: "true" } : { quantity: fixed(levels.size, market.szDecimals), reduceOnly: "true" }),
      workingType: "MARK_PRICE",
      ...builderFields(user),
    });
  }
}

function createAsterVenue(): PerpVenue {
  let cache: { at: number; markets: Promise<VenueMarket[]> } | null = null;

  function listMarkets() {
    if (!cache || Date.now() - cache.at > MARKETS_TTL_MS) {
      // Our server's cached copy (one Aster call per 30s for every visitor), else Aster directly.
      const markets = fetch("/api/aster/markets")
        .then((response) => (response.ok ? (response.json() as Promise<VenueMarket[]>) : Promise.reject(new Error(`Markets route answered ${response.status}`))))
        .then((list) => (Array.isArray(list) && list.length > 0 ? list : Promise.reject(new Error("Markets route listed nothing"))))
        .catch(() => directMarkets());
      cache = { at: Date.now(), markets };
      markets.catch(() => (cache = null));
    }
    return cache.markets;
  }

  function directMarkets() {
    return Promise.all([
      publicGet<{ symbols?: unknown[] }>("/fapi/v1/exchangeInfo"),
      publicGet<unknown[]>("/fapi/v1/ticker/24hr"),
      publicGet<unknown[]>("/fapi/v1/premiumIndex"),
    ]).then(([info, tickers, premium]) =>
      readAsterMarkets(
        (info.symbols ?? []) as Parameters<typeof readAsterMarkets>[0],
        (Array.isArray(tickers) ? tickers : []) as Parameters<typeof readAsterMarkets>[1],
        (Array.isArray(premium) ? premium : []) as Parameters<typeof readAsterMarkets>[2],
      ),
    );
  }

  async function placeOrder(user: `0x${string}`, input: PlaceOrderInput): Promise<OrderResult> {
    const { market } = input;
    await applySettings(user, market, input);
    const fee = builderFields(user);
    const order = await signed<AsterOrderResponse>(user, "POST", "/fapi/v3/order", {
      symbol: market.coin,
      side: input.side === "buy" ? "BUY" : "SELL",
      type: input.kind === "limit" ? "LIMIT" : "MARKET",
      quantity: fixed(input.size, market.szDecimals),
      ...(input.kind === "limit" && input.limitPx ? { price: fixed(input.limitPx, market.priceDecimals ?? 2), timeInForce: "GTC" } : {}),
      ...(input.reduceOnly ? { reduceOnly: "true" } : {}),
      newOrderRespType: "RESULT",
      ...fee,
    });
    if (input.takeProfit || input.stopLoss) {
      await placeTriggers(user, market, input.side === "buy" ? "SELL" : "BUY", { takeProfit: input.takeProfit, stopLoss: input.stopLoss });
    }
    return toResult(order, Number(fee.feeRate ?? 0));
  }

  async function cancelOrder(user: `0x${string}`, order: Pick<VenueOpenOrder, "coin" | "oid">) {
    await signed(user, "DELETE", "/fapi/v3/order", { symbol: order.coin, orderId: order.oid });
  }

  async function closePosition(user: `0x${string}`, position: PositionRef, size?: number): Promise<OrderResult> {
    const market = (await listMarkets()).find((entry) => entry.coin === position.coin);
    if (!market) throw new VenueError(`Aster doesn't list ${position.symbol} anymore.`);
    const fee = builderFields(user);
    const order = await signed<AsterOrderResponse>(user, "POST", "/fapi/v3/order", {
      symbol: market.coin,
      side: position.size > 0 ? "SELL" : "BUY",
      type: "MARKET",
      quantity: fixed(Math.min(size ?? Infinity, Math.abs(position.size)), market.szDecimals),
      reduceOnly: "true",
      newOrderRespType: "RESULT",
      ...fee,
    });
    return toResult(order, Number(fee.feeRate ?? 0));
  }

  async function setPositionTpsl(user: `0x${string}`, position: PositionRef, levels: PositionTpsl) {
    const market = (await listMarkets()).find((entry) => entry.coin === position.coin);
    if (!market) throw new VenueError(`Aster doesn't list ${position.symbol} anymore.`);
    const partial = levels.size !== undefined && levels.size < Math.abs(position.size);
    await placeTriggers(user, market, position.size > 0 ? "SELL" : "BUY", { ...levels, size: partial ? levels.size : undefined });
  }

  /** Positions, orders and balance every few seconds (signed reads need the agent; before setup the account is empty). */
  function subscribeAccount(user: `0x${string}`, handlers: AccountHandlers) {
    let active = true;
    const read = async () => {
      if (!readAsterRecord(user).agent) {
        handlers.onSnapshot({ positions: [], orders: [], accountValue: 0, withdrawable: 0 });
        return;
      }
      try {
        const [markets, positions, orders, account] = await Promise.all([
          listMarkets(),
          signed<AsterPositionRow[]>(user, "GET", "/fapi/v3/positionRisk"),
          signed<AsterOrderRow[]>(user, "GET", "/fapi/v3/openOrders"),
          signed<AsterAccountInfo>(user, "GET", "/fapi/v3/account"),
        ]);
        if (active) handlers.onSnapshot(readAsterAccount(markets, Array.isArray(positions) ? positions : [], Array.isArray(orders) ? orders : [], account));
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
    const rows = await publicGet<unknown>("/fapi/v1/klines", { symbol: market.coin, interval: CANDLE_INTERVALS.has(interval) ? interval : "1h", startTime, limit: 1500 });
    return readAsterCandles(rows);
  }

  return {
    kind: "perp",
    id: "aster",
    name: "Aster",
    network: "mainnet",
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

export const asterVenue = createAsterVenue();
