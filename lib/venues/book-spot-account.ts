"use client";

import { readHlSpotMarkets, readLighterSpotMarkets, type BookSpotMarket, type BookSpotVenue } from "@/lib/spot/book-spot";
import { readHlSpotBalances, readHlSpotOrderRows, readLighterSpotBalances, type SpotBalance, type SpotOpenOrderRow } from "@/lib/spot/book-spot-account";
import { fromHlHistoricalOrder, fromLighterOrder, type HlHistoricalOrder, type OrderHistoryRow } from "@/lib/trading/order-history";
import { hlConfig } from "./hyperliquid/config";
import { readOpenOrder } from "./lighter/account";
import { getAccountIndex, lighterGet } from "./lighter/api";
import { lighterConfig } from "./lighter/config";
import { authToken, loadSession } from "./lighter/session";

/**
 * Loads the Spot Dex panel's data for a wallet: every Hyperliquid and Lighter spot market (to name and price what
 * the account holds), balances, open orders and the last orders on spot markets. Lighter's orders need the trading
 * key's auth token, so they're only read in a browser that holds the key (`lighterOrdersReadable`). Loaded on demand
 * by the panel; nothing here runs on the first screen.
 */

const HISTORY_LIMIT = 100;

async function hlInfo<T>(body: unknown): Promise<T> {
  const response = await fetch(`${hlConfig.apiUrl}/info`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Hyperliquid answered ${response.status}.`);
  return (await response.json()) as T;
}

export interface SpotAccountData {
  balances: SpotBalance[];
  orders: SpotOpenOrderRow[];
  /** Spot orders only, newest first; each row's symbol reads "HYPE/USDC". */
  history: Array<OrderHistoryRow & { spotVenue: BookSpotVenue }>;
  lighterOrdersReadable: boolean;
}

async function hyperliquid(user: `0x${string}`): Promise<Omit<SpotAccountData, "lighterOrdersReadable">> {
  const [meta, state, open, past] = await Promise.all([
    hlInfo<unknown>({ type: "spotMetaAndAssetCtxs" }),
    hlInfo<unknown>({ type: "spotClearinghouseState", user }),
    hlInfo<unknown>({ type: "openOrders", user }),
    hlInfo<HlHistoricalOrder[]>({ type: "historicalOrders", user }).catch(() => []),
  ]);
  const markets = readHlSpotMarkets(meta, 0);
  const byCoin = new Map(markets.map((market) => [market.coin, market]));
  return {
    balances: readHlSpotBalances(state, markets),
    orders: readHlSpotOrderRows(open, markets),
    history: (Array.isArray(past) ? past : [])
      .filter((entry) => byCoin.has(entry?.order?.coin) && entry.status !== "open")
      .slice(0, HISTORY_LIMIT)
      .map((entry) => ({ ...fromHlHistoricalOrder(entry, (coin) => `${byCoin.get(coin)!.base}/USDC`), spotVenue: "hyperliquid" as const })),
  };
}

async function lighter(user: string): Promise<SpotAccountData> {
  const empty: SpotAccountData = { balances: [], orders: [], history: [], lighterOrdersReadable: false };
  const accountIndex = await getAccountIndex(lighterConfig, user);
  if (accountIndex === null) return empty;
  const [details, account] = await Promise.all([
    lighterGet(lighterConfig, "orderBookDetails", { filter: "spot" }),
    lighterGet(lighterConfig, "account", { by: "index", value: accountIndex }),
  ]);
  const markets = readLighterSpotMarkets(details);
  const record = (Array.isArray(account.accounts) ? account.accounts[0] : null) as { assets?: unknown } | null;
  const balances = readLighterSpotBalances(record?.assets, markets);
  const session = await loadSession(lighterConfig, user).catch(() => null);
  if (!session) return { ...empty, balances };
  const auth = await authToken(session);
  const byId = new Map(markets.map((market) => [market.id, market]));
  const [active, inactive] = await Promise.all([
    Promise.all(
      markets.map((market) =>
        lighterGet(lighterConfig, "accountActiveOrders", { account_index: accountIndex, market_id: market.id }, auth)
          .then((body) => (Array.isArray(body.orders) ? body.orders : []))
          .catch(() => []),
      ),
    ),
    lighterGet(lighterConfig, "accountInactiveOrders", { account_index: accountIndex, limit: HISTORY_LIMIT }, auth)
      .then((body) => (Array.isArray(body.orders) ? (body.orders as Array<Record<string, unknown>>) : []))
      .catch(() => []),
  ]);
  const orders = active.flat().flatMap((value): SpotOpenOrderRow[] => {
    const order = readOpenOrder(value, (id) => byId.get(id)?.coin);
    const market = order ? markets.find((entry) => entry.coin === order.coin) : undefined;
    if (!order || !market) return [];
    return [{ venue: "lighter", market, oid: order.oid, side: order.side, price: order.limitPx, size: order.size, origSize: order.origSize, time: order.timestamp }];
  });
  const history = inactive.flatMap((value) => {
    const row = fromLighterOrder(value, (id) => (byId.has(id) ? `${byId.get(id)!.base}/USDC` : null));
    return row ? [{ ...row, spotVenue: "lighter" as const }] : [];
  });
  return { balances, orders, history, lighterOrdersReadable: true };
}

export async function loadSpotAccount(user: `0x${string}`, venues: Record<BookSpotVenue, boolean>): Promise<SpotAccountData> {
  const [hl, lt] = await Promise.all([
    venues.hyperliquid ? hyperliquid(user).catch(() => null) : null,
    venues.lighter ? lighter(user).catch(() => null) : null,
  ]);
  return {
    balances: [...(hl?.balances ?? []), ...(lt?.balances ?? [])].sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1)),
    orders: [...(hl?.orders ?? []), ...(lt?.orders ?? [])].sort((a, b) => b.time - a.time),
    history: [...(hl?.history ?? []), ...(lt?.history ?? [])].sort((a, b) => b.time - a.time),
    lighterOrdersReadable: lt?.lighterOrdersReadable ?? false,
  };
}

/** Cancels a resting spot order on its venue (the venue modules load on demand). */
export async function cancelSpotOrder(user: `0x${string}`, market: BookSpotMarket, oid: number) {
  if (market.venue === "hyperliquid") return (await import("./hyperliquid/spot")).cancelHlSpotOrder(user, market, oid);
  return (await import("./lighter/spot")).cancelLighterSpotOrder(user, market, oid);
}
