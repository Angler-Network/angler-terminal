"use client";

import type {
  AccountSnapshot,
  Candle,
  OrderResult,
  PerpVenue,
  PlaceOrderInput,
  VenueMarket,
  VenueOpenOrder,
  VenuePosition,
  PositionTpsl,
} from "../types";
import { VenueError } from "../types";
import { browserStorage, readOnboarding } from "./agent-store";
import { agentExchange, infoClient, subscriptionClient } from "./clients";
import { DEFAULT_SLIPPAGE, hlConfig } from "./config";
import { toVenueError } from "./errors";
import { builderDexes, findMarket, marketsFromMeta, splitCoin } from "./markets";
import { roundPrice, roundSize, slippagePrice, toWire } from "./pricing";

const MARKETS_TTL_MS = 60_000;

let marketCache: { at: number; promise: Promise<VenueMarket[]> } | null = null;

/** Fallback when /api/hl/markets is down: same Info API calls, from the browser. */
async function loadMarketsDirect() {
  const info = await infoClient();
  const [main, perpDexs] = await Promise.all([info.metaAndAssetCtxs(), info.perpDexs()]);
  const hip3 = await Promise.allSettled(
    builderDexes(perpDexs, hlConfig.hip3Dexes).map(async (dex) => {
      const [meta, ctxs] = await info.metaAndAssetCtxs({ dex: dex.name });
      return marketsFromMeta(dex.index, dex.name, meta, ctxs);
    }),
  );
  return [...marketsFromMeta(0, "", main[0], main[1]), ...hip3.flatMap((result) => (result.status === "fulfilled" ? result.value : []))];
}

async function loadMarkets(): Promise<VenueMarket[]> {
  try {
    const response = await fetch(`/api/hl/markets?network=${hlConfig.network}`);
    if (response.ok) {
      const markets = (await response.json()) as VenueMarket[];
      if (Array.isArray(markets) && markets.length > 0) return markets;
    }
  } catch {}
  return loadMarketsDirect();
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

export function requireTradingSetup(user: `0x${string}`) {
  const storage = browserStorage();
  const record = storage ? readOnboarding(storage, hlConfig.network, user) : {};
  if (!hlConfig.builder) {
    throw new VenueError("Trading is disabled: NEXT_PUBLIC_HL_BUILDER_ADDRESS is not configured.");
  }
  if (!record.agent) throw new VenueError("Set up trading first: approve the builder fee and create a trading key.");
  return { agent: record.agent, builder: hlConfig.builder };
}

/** Leverage the venue last set per user and asset during this session, so it's only re-sent when it changes. */
const appliedLeverage = new Map<string, string>();

async function midPrice(market: VenueMarket) {
  const mids = await (await infoClient()).allMids(market.dex ? { dex: market.dex } : undefined);
  const mid = Number(mids[market.coin]);
  if (!(mid > 0)) throw new VenueError(`No mid price for ${market.symbol} right now.`);
  return mid;
}

/**
 * Reduce-only trigger orders closing `size` on the `closeIsBuy` side: market when triggered, with the slippage bound
 * as the limit price.
 */
function triggerOrders(market: VenueMarket, closeIsBuy: boolean, size: number, levels: PositionTpsl) {
  const order = (triggerPx: number, tpsl: "tp" | "sl") => ({
    a: market.assetId,
    b: closeIsBuy,
    p: toWire(slippagePrice(triggerPx, closeIsBuy, DEFAULT_SLIPPAGE, market.szDecimals)),
    s: toWire(size),
    r: true,
    t: { trigger: { isMarket: true, triggerPx: toWire(roundPrice(triggerPx, market.szDecimals)), tpsl } },
  });
  return [
    ...(levels.takeProfit ? [order(levels.takeProfit, "tp")] : []),
    ...(levels.stopLoss ? [order(levels.stopLoss, "sl")] : []),
  ];
}

async function setPositionTpsl(user: `0x${string}`, position: VenuePosition, levels: PositionTpsl) {
  const { agent, builder } = requireTradingSetup(user);
  const market = findMarket(await listMarkets(), position.coin);
  if (!market) throw new VenueError(`Unknown market ${position.coin}.`);
  const orders = triggerOrders(market, position.size < 0, roundSize(Math.abs(position.size), market.szDecimals), levels);
  if (orders.length === 0) throw new VenueError("Set a take profit or a stop loss.");
  try {
    const exchange = await agentExchange(agent.privateKey);
    // positionTpsl: tied to the position, resized with it and canceled when it closes.
    const result = await exchange.order({ orders, grouping: "positionTpsl", builder: { b: builder.address, f: builder.fee } });
    for (const status of result.response.data.statuses) {
      if (typeof status === "object" && status && "error" in status) throw new VenueError(String((status as { error: unknown }).error));
    }
  } catch (error) {
    throw toVenueError(error);
  }
}

async function placeOrder(user: `0x${string}`, input: PlaceOrderInput): Promise<OrderResult> {
  const { agent, builder } = requireTradingSetup(user);
  const { market } = input;
  const isBuy = input.side === "buy";
  const size = roundSize(input.size, market.szDecimals);
  if (!(size > 0)) throw new VenueError(`Size is below ${market.symbol}'s lot size (${10 ** -market.szDecimals}).`);

  try {
    const exchange = await agentExchange(agent.privateKey);

    if (input.leverage && !input.reduceOnly) {
      const isCross = market.onlyIsolated ? false : (input.isCross ?? true);
      const leverage = Math.max(1, Math.min(market.maxLeverage, Math.round(input.leverage)));
      const key = `${user}:${market.assetId}`;
      const wanted = `${leverage}:${isCross}`;
      if (appliedLeverage.get(key) !== wanted) {
        await exchange.updateLeverage({ asset: market.assetId, isCross, leverage });
        appliedLeverage.set(key, wanted);
      }
    }

    let price: number;
    if (input.kind === "market") {
      price = slippagePrice(await midPrice(market), isBuy, DEFAULT_SLIPPAGE, market.szDecimals);
    } else {
      if (!input.limitPx || !(input.limitPx > 0)) throw new VenueError("Enter a limit price.");
      price = roundPrice(input.limitPx, market.szDecimals);
    }

    const triggers = triggerOrders(market, !isBuy, size, input);
    const result = await exchange.order({
      orders: [
        {
          a: market.assetId,
          b: isBuy,
          p: toWire(price),
          s: toWire(size),
          r: Boolean(input.reduceOnly),
          // Market orders are aggressive IOC limits; the slippage price caps how far they can fill.
          t: { limit: { tif: input.kind === "market" ? "Ioc" : "Gtc" } },
        },
        ...triggers,
      ],
      // normalTpsl: the TP/SL orders only become active once the entry fills.
      grouping: triggers.length > 0 ? "normalTpsl" : "na",
      builder: { b: builder.address, f: builder.fee },
    });

    const status = result.response.data.statuses[0];
    if (typeof status === "object" && "filled" in status) {
      return {
        status: "filled",
        oid: status.filled.oid,
        filledSize: Number(status.filled.totalSz),
        avgPx: Number(status.filled.avgPx),
        // The builder fee is in tenths of a bp.
        partnerFeeBps: builder.fee / 10,
      };
    }
    if (typeof status === "object" && "resting" in status) return { status: "resting", oid: status.resting.oid };
    throw new VenueError("Hyperliquid accepted the order but returned no fill or resting status.");
  } catch (error) {
    throw toVenueError(error);
  }
}

async function cancelOrder(user: `0x${string}`, order: Pick<VenueOpenOrder, "coin" | "oid">) {
  const { agent } = requireTradingSetup(user);
  const market = findMarket(await listMarkets(), order.coin);
  if (!market) throw new VenueError(`Unknown market ${order.coin}.`);
  try {
    await (await agentExchange(agent.privateKey)).cancel({ cancels: [{ a: market.assetId, o: order.oid }] });
  } catch (error) {
    throw toVenueError(error);
  }
}

async function closePosition(user: `0x${string}`, position: VenuePosition) {
  const market = findMarket(await listMarkets(), position.coin);
  if (!market) throw new VenueError(`Unknown market ${position.coin}.`);
  return placeOrder(user, {
    market,
    side: position.size > 0 ? "sell" : "buy",
    kind: "market",
    size: Math.abs(position.size),
    reduceOnly: true,
  });
}

type ClearinghouseState = {
  assetPositions: Array<{
    position: {
      coin: string;
      szi: string;
      entryPx: string;
      positionValue: string;
      unrealizedPnl: string;
      returnOnEquity: string;
      liquidationPx: string | null;
      leverage: { type: "cross" | "isolated"; value: number };
    };
  }>;
  marginSummary: { accountValue: string };
  withdrawable: string;
};

type FrontendOrder = {
  coin: string;
  side: "B" | "A";
  limitPx: string;
  sz: string;
  origSz: string;
  oid: number;
  orderType: string;
  reduceOnly: boolean;
  timestamp: number;
};

export function toPositions(dex: string, state: ClearinghouseState): VenuePosition[] {
  return state.assetPositions.flatMap(({ position }) => {
    const size = Number(position.szi);
    if (!size) return [];
    return [
      {
        venue: "hyperliquid",
        coin: position.coin,
        symbol: splitCoin(position.coin).symbol,
        dex,
        size,
        entryPx: Number(position.entryPx),
        positionValue: Number(position.positionValue),
        unrealizedPnl: Number(position.unrealizedPnl),
        returnOnEquity: Number(position.returnOnEquity),
        liquidationPx: position.liquidationPx ? Number(position.liquidationPx) : null,
        leverage: position.leverage.value,
        leverageType: position.leverage.type,
      },
    ];
  });
}

export function toOpenOrders(dex: string, orders: FrontendOrder[]): VenueOpenOrder[] {
  return orders.map((order) => ({
    venue: "hyperliquid",
    coin: order.coin,
    symbol: splitCoin(order.coin).symbol,
    dex,
    oid: order.oid,
    side: order.side === "B" ? "buy" : "sell",
    limitPx: Number(order.limitPx),
    size: Number(order.sz),
    origSize: Number(order.origSz),
    orderType: order.orderType,
    reduceOnly: order.reduceOnly,
    timestamp: order.timestamp,
  }));
}

function subscribeAccount(user: `0x${string}`, handlers: Parameters<PerpVenue["subscribeAccount"]>[1]) {
  const subs = subscriptionClient();
  const positionsByDex = new Map<string, VenuePosition[]>();
  const ordersByDex = new Map<string, VenueOpenOrder[]>();
  let totals = { accountValue: 0, withdrawable: 0 };
  let isActive = true;
  const unsubscribers: Array<() => Promise<void>> = [];

  const emit = () => {
    if (!isActive) return;
    const snapshot: AccountSnapshot = {
      positions: [...positionsByDex.values()].flat(),
      orders: [...ordersByDex.values()].flat().sort((a, b) => b.timestamp - a.timestamp),
      ...totals,
    };
    handlers.onSnapshot(snapshot);
  };

  const track = async (subscribe: Promise<{ unsubscribe: () => Promise<void> }>) => {
    try {
      const subscription = await subscribe;
      if (isActive) unsubscribers.push(subscription.unsubscribe);
      else void subscription.unsubscribe();
    } catch (error) {
      handlers.onError?.(error);
    }
  };

  void track(
    subs.then((client) => client.allDexsClearinghouseState({ user }, (event) => {
      let accountValue = 0;
      let withdrawable = 0;
      for (const [dex, state] of event.clearinghouseStates) {
        positionsByDex.set(dex, toPositions(dex, state as ClearinghouseState));
        accountValue += Number(state.marginSummary.accountValue) || 0;
        if (dex === "") withdrawable = Number(state.withdrawable) || 0;
      }
      totals = { accountValue, withdrawable };
      emit();
    })),
  );

  void listMarkets()
    .then((markets) => {
      const dexes = ["", ...new Set(markets.map((market) => market.dex).filter(Boolean))];
      for (const dex of dexes) {
        if (!isActive) return;
        void track(
          subs.then((client) =>
            client.openOrders({ user, dex }, (event) => {
              ordersByDex.set(event.dex, toOpenOrders(event.dex, event.orders as FrontendOrder[]));
              emit();
            }),
          ),
        );
      }
    })
    .catch((error: unknown) => handlers.onError?.(error));

  return () => {
    isActive = false;
    for (const unsubscribe of unsubscribers.splice(0)) void unsubscribe().catch(() => {});
  };
}

type HlInterval = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "8h" | "12h" | "1d" | "3d" | "1w" | "1M";

/** Plain Info API call (not the SDK) so the chart doesn't pull the trading SDK into the first load. */
async function loadCandles(market: VenueMarket, interval: string, startTime: number): Promise<Candle[]> {
  const response = await fetch(`${hlConfig.apiUrl}/info`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin: market.coin, interval: interval as HlInterval, startTime } }),
  });
  if (!response.ok) throw new VenueError(`Hyperliquid candles failed (${response.status}).`);
  const rows = (await response.json()) as Array<{ t: number; o: string; h: string; l: string; c: string; v: string }>;
  return rows.map((row) => ({
    time: row.t,
    open: Number(row.o),
    high: Number(row.h),
    low: Number(row.l),
    close: Number(row.c),
    volume: Number(row.v),
  }));
}

export const hyperliquidVenue: PerpVenue = {
  kind: "perp",
  id: "hyperliquid",
  name: "Hyperliquid",
  network: hlConfig.network,
  listMarkets,
  resolveMarket: async (symbol) => findMarket(await listMarkets(), symbol),
  placeOrder,
  cancelOrder,
  closePosition,
  setPositionTpsl,
  subscribeAccount,
  loadCandles,
};
