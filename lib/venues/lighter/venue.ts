"use client";

import type { AccountHandlers, Candle, OrderResult, PerpVenue, PlaceOrderInput, VenueMarket, VenueOpenOrder, VenuePosition } from "../types";
import { VenueError } from "../types";
import {
  applyAccountAll,
  applyOrders,
  applyUserStats,
  emptyAccountState,
  readOrderOutcome,
  toSnapshot,
} from "./account";
import { accountOrders, bestPrices, getAccountIndex, lighterGet, txStatus } from "./api";
import { DEFAULT_SLIPPAGE, lighterConfig } from "./config";
import { humanizeLighterStatus, LighterApiError, toLighterVenueError } from "./errors";
import { findLighterMarket, readOrderBookDetails } from "./markets";
import { baseAmountFor, fromUnits, leverageFraction, minimumSize, nextClientOrderIndex, toUnits, worstPrice } from "./pricing";
import { authToken, loadSession, requireSession, signAndSend, type LighterSession } from "./session";
import { signCancelOrder, signCreateOrder, signUpdateLeverage } from "./signer";

const MARKETS_TTL_MS = 60_000;
const CONFIRM_TIMEOUT_MS = 15_000;
const CONFIRM_INTERVAL_MS = 600;
/** Limit orders rest for 28 days (Lighter allows 5 minutes to 30 days). */
const LIMIT_EXPIRY_MS = 28 * 24 * 3600 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let marketCache: { at: number; promise: Promise<VenueMarket[]> } | null = null;

async function loadMarkets(): Promise<VenueMarket[]> {
  try {
    const response = await fetch(`/api/lighter/markets?network=${lighterConfig.network}`);
    if (response.ok) {
      const markets = (await response.json()) as VenueMarket[];
      if (Array.isArray(markets) && markets.length > 0) return markets;
    }
  } catch {}
  // Fallback when our route is down: the same public endpoint, from the browser.
  return readOrderBookDetails(await lighterGet("orderBookDetails"));
}

function listMarkets() {
  if (!marketCache || Date.now() - marketCache.at > MARKETS_TTL_MS) {
    const promise = loadMarkets();
    marketCache = { at: Date.now(), promise };
    promise.catch(() => {
      if (marketCache?.promise === promise) marketCache = null;
    });
  }
  return marketCache.promise;
}

let lastClientOrderIndex = 0;

function clientOrderIndex() {
  lastClientOrderIndex = nextClientOrderIndex(Date.now(), lastClientOrderIndex);
  return lastClientOrderIndex;
}

/** Leverage this tab last set per account and market, so it's only re-sent when it changes. */
const appliedLeverage = new Map<string, string>();

async function referencePrice(market: VenueMarket, isBuy: boolean) {
  const book = await bestPrices(market.assetId).catch(() => ({ bid: null, ask: null }));
  const price = (isBuy ? book.ask : book.bid) ?? market.markPx ?? market.midPx;
  if (!price) throw new VenueError(`No price for ${market.symbol} on Lighter right now.`);
  return price;
}

/** Integrator attribution for orders: the configured fee, capped by what the user approved (0 on Standard). */
function integratorFields(session: LighterSession) {
  const integrator = lighterConfig.integrator;
  const approved = session.record.integrator;
  if (!integrator || !approved || approved.accountIndex !== integrator.accountIndex || approved.expiresAt <= Date.now()) return undefined;
  return { accountIndex: integrator.accountIndex, takerFee: Math.min(integrator.takerFee, approved.maxTakerFee), makerFee: 0 };
}

/**
 * `sendTx` 200 only means accepted. Polls the order by its client index until it filled, rests, or was canceled
 * (IOC that couldn't fill); checks the tx itself now and then in case the sequencer rejected it outright.
 */
async function confirmOrder(session: LighterSession, clientIndex: number, hash: string, market: VenueMarket): Promise<OrderResult> {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  const auth = await authToken(session);
  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    await sleep(CONFIRM_INTERVAL_MS);
    const [order] = await accountOrders(session.accountIndex, [clientIndex], auth).catch(() => []);
    if (order) {
      const outcome = readOrderOutcome(order);
      if (outcome.state === "filled") return { status: "filled", oid: outcome.orderIndex, filledSize: outcome.filledSize, avgPx: outcome.avgPx };
      if (outcome.state === "resting") return { status: "resting", oid: outcome.orderIndex };
      if (outcome.state === "canceled") throw new VenueError(humanizeLighterStatus(outcome.status), outcome.status);
    } else if (attempt % 4 === 3) {
      const tx = await txStatus(hash).catch(() => null);
      if (tx?.status === 0) {
        let reason = "";
        try {
          reason = String((JSON.parse(tx.eventInfo) as { ae?: unknown }).ae ?? "");
        } catch {}
        throw new LighterApiError(0, reason || `Lighter rejected the ${market.symbol} order.`);
      }
    }
  }
  throw new VenueError(`Lighter accepted the ${market.symbol} order but hasn't confirmed it yet. Check your positions before trying again.`);
}

async function placeOrder(user: `0x${string}`, input: PlaceOrderInput): Promise<OrderResult> {
  const { market } = input;
  if (market.venue !== "lighter" || market.priceDecimals === undefined) throw new VenueError(`${market.symbol} isn't a Lighter market.`);
  const isBuy = input.side === "buy";
  try {
    const session = await requireSession(user);
    const reference = input.kind === "market" ? await referencePrice(market, isBuy) : input.limitPx;
    if (!reference || !(reference > 0)) throw new VenueError("Enter a limit price.");
    const baseAmount = baseAmountFor(input.size, market.szDecimals);
    if (baseAmount <= 0) throw new VenueError(`Size is below ${market.symbol}'s size step (${10 ** -market.szDecimals}).`);
    // Minimums apply to opening orders; a reduce-only close must be able to flatten any remainder.
    const minimum = minimumSize(market, reference);
    if (!input.reduceOnly && fromUnits(baseAmount, market.szDecimals) < minimum) {
      throw new VenueError(`Order is too small. Lighter's minimum for ${market.symbol} is ${minimum} (about $${Math.ceil(minimum * reference)}).`);
    }

    if (input.leverage && !input.reduceOnly) {
      const leverage = Math.max(1, Math.min(market.maxLeverage, Math.round(input.leverage)));
      const isolated = market.onlyIsolated || input.isCross === false;
      const key = `${lighterConfig.network}:${session.accountIndex}:${market.assetId}`;
      const wanted = `${leverage}:${isolated}`;
      if (appliedLeverage.get(key) !== wanted) {
        // Sequenced before the order on the same key, so the order executes with the new leverage.
        await signAndSend(session, (nonce) => signUpdateLeverage(session.signer, market.assetId, leverageFraction(leverage), isolated, nonce));
        appliedLeverage.set(key, wanted);
      }
    }

    const price =
      input.kind === "market"
        ? worstPrice(reference, isBuy, DEFAULT_SLIPPAGE, market.priceDecimals)
        : toUnits(reference, market.priceDecimals, "round");
    const clientIndex = clientOrderIndex();
    const hash = await signAndSend(session, (nonce) =>
      signCreateOrder(
        session.signer,
        {
          marketIndex: market.assetId,
          clientOrderIndex: clientIndex,
          baseAmount,
          price,
          isAsk: !isBuy,
          orderType: input.kind === "market" ? 1 : 0,
          timeInForce: input.kind === "market" ? 0 : 1,
          reduceOnly: Boolean(input.reduceOnly),
          orderExpiry: input.kind === "market" ? 0 : Date.now() + LIMIT_EXPIRY_MS,
          integrator: integratorFields(session),
        },
        nonce,
      ),
    );
    return await confirmOrder(session, clientIndex, hash, market);
  } catch (error) {
    throw toLighterVenueError(error);
  }
}

async function cancelOrder(user: `0x${string}`, order: Pick<VenueOpenOrder, "coin" | "oid">) {
  const market = findLighterMarket(await listMarkets(), order.coin);
  if (!market) throw new VenueError(`Unknown Lighter market ${order.coin}.`);
  try {
    const session = await requireSession(user);
    await signAndSend(session, (nonce) => signCancelOrder(session.signer, market.assetId, order.oid, nonce));
  } catch (error) {
    throw toLighterVenueError(error);
  }
}

async function closePosition(user: `0x${string}`, position: VenuePosition) {
  const market = findLighterMarket(await listMarkets(), position.coin);
  if (!market) throw new VenueError(`Unknown Lighter market ${position.coin}.`);
  return placeOrder(user, { market, side: position.size > 0 ? "sell" : "buy", kind: "market", size: Math.abs(position.size), reduceOnly: true });
}

const PING_MS = 60_000;
const ACCOUNT_RETRY_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Live positions (account_all), balances (user_stats) and, once a key is registered, open orders
 * (account_all_orders, auth required) over Lighter's WebSocket. Pings every minute (the server closes idle
 * sockets after 2), reconnects with backoff and resubscribes; every resubscribe starts from a fresh snapshot.
 */
function subscribeAccount(user: `0x${string}`, handlers: AccountHandlers) {
  let isActive = true;
  let socket: WebSocket | null = null;
  let ping: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let backoff = 1000;
  const state = emptyAccountState();
  let symbols = new Map<number, string>();
  const symbolFor = (marketId: number) => symbols.get(marketId);
  const emit = () => isActive && handlers.onSnapshot(toSnapshot(state));

  const schedule = (run: () => void, ms: number) => {
    if (!isActive) return;
    clearTimeout(retry);
    retry = setTimeout(run, ms);
  };

  const connect = async () => {
    if (!isActive) return;
    let accountIndex: number | null;
    try {
      [accountIndex, symbols] = await Promise.all([
        getAccountIndex(user),
        listMarkets().then((markets) => new Map(markets.map((market) => [market.assetId, market.symbol]))),
      ]);
    } catch (error) {
      handlers.onError?.(toLighterVenueError(error));
      return schedule(() => void connect(), ACCOUNT_RETRY_MS);
    }
    if (accountIndex === null) {
      // No account until the first deposit: show an empty account and look again later.
      emit();
      return schedule(() => void connect(), ACCOUNT_RETRY_MS);
    }
    const session = await loadSession(user).catch(() => null);
    const auth = session ? await authToken(session).catch(() => null) : null;
    if (!isActive) return;

    const ws = new WebSocket(lighterConfig.wsUrl);
    socket = ws;
    ws.onopen = () => {
      backoff = 1000;
      ws.send(JSON.stringify({ type: "subscribe", channel: `account_all/${accountIndex}` }));
      ws.send(JSON.stringify({ type: "subscribe", channel: `user_stats/${accountIndex}` }));
      if (auth) ws.send(JSON.stringify({ type: "subscribe", channel: `account_all_orders/${accountIndex}`, auth }));
      else state.orders.clear();
      clearInterval(ping);
      ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ping" })), PING_MS);
    };
    ws.onmessage = (event) => {
      let message: { type?: string; error?: { code?: number; message?: string } };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const type = message.type ?? "";
      const isSnapshot = type.startsWith("subscribed/");
      if (type.endsWith("/account_all")) applyAccountAll(state, message, isSnapshot);
      else if (type.endsWith("/user_stats")) applyUserStats(state, message);
      else if (type.endsWith("/account_all_orders")) applyOrders(state, message, isSnapshot, symbolFor);
      else {
        if (message.error) handlers.onError?.(new LighterApiError(message.error.code ?? 0, message.error.message ?? "WebSocket error"));
        return;
      }
      emit();
    };
    ws.onclose = () => {
      clearInterval(ping);
      if (!isActive || socket !== ws) return;
      schedule(() => void connect(), backoff);
      backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
    };
  };

  void connect();

  return () => {
    isActive = false;
    clearTimeout(retry);
    clearInterval(ping);
    const ws = socket;
    socket = null;
    ws?.close();
  };
}

const RESOLUTIONS = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "12h", "1d"]);
const MAX_CANDLES = 500;

async function loadCandles(market: VenueMarket, interval: string, startTime: number): Promise<Candle[]> {
  const resolution = RESOLUTIONS.has(interval) ? interval : "1h";
  const body = await lighterGet("candles", {
    market_id: market.assetId,
    resolution,
    start_timestamp: Math.max(0, Math.floor(startTime)),
    end_timestamp: Date.now(),
    count_back: MAX_CANDLES,
  });
  const rows = Array.isArray(body.c) ? (body.c as Array<Record<string, number>>) : [];
  return rows.map((row) => ({ time: row.t, open: row.o, high: row.h, low: row.l, close: row.c, volume: row.v ?? 0 }));
}

export const lighterVenue: PerpVenue = {
  kind: "perp",
  id: "lighter",
  name: "Lighter",
  network: lighterConfig.network,
  listMarkets,
  resolveMarket: async (symbol) => findLighterMarket(await listMarkets(), symbol),
  placeOrder,
  cancelOrder,
  closePosition,
  subscribeAccount,
  loadCandles,
};

