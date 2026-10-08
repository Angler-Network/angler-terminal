"use client";

import { readSpotUsdc } from "@/lib/prediction/hip4-trade";
import { HL_SPOT_MIN_ORDER_USD, readHlSpotMarkets, readHlSpotOpenOrders, type BookSpotMarket, type BookSpotOpenOrder } from "@/lib/spot/book-spot";
import { VenueError } from "../types";
import { agentExchange } from "./clients";
import { DEFAULT_SLIPPAGE, hlConfig } from "./config";
import { toVenueError } from "./errors";
import { roundPrice, roundSize, slippagePrice, toWire } from "./pricing";
import { requireTradingSetup } from "./venue";
import { vipFee } from "@/lib/profile/vip";

/**
 * Hyperliquid spot with the account, agent key and builder fee the terminal already uses for perps. Spot spends spot
 * USDC (the shared balance on a unified account); a standard account moves USDC from perps first (`moveUsdcToSpot`,
 * signed by the wallet). Order asset id = 10000 + pair index.
 */

async function info<T>(body: unknown): Promise<T> {
  const response = await fetch(`${hlConfig.apiUrl}/info`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new VenueError(`Hyperliquid answered ${response.status}.`);
  return (await response.json()) as T;
}

/** Any listed pair, whatever its volume (the search only lists the traded ones). */
export async function loadHlSpotMarket(id: number): Promise<BookSpotMarket | null> {
  const markets = readHlSpotMarkets(await info<unknown>({ type: "spotMetaAndAssetCtxs" }), 0);
  return markets.find((market) => market.id === id) ?? null;
}

export interface HlSpotAccount {
  /** USDC a buy can spend: spot USDC, or the perp margin too on a unified account. */
  spendable: number;
  /** Spot USDC alone (what a standard account must top up from perps). */
  spotUsdc: number;
  /** Perp USDC a standard account could move to spot. */
  perpsAvailable: number;
  unified: boolean;
  /** Free balance of the market's base token. */
  base: number;
}

/** Free balance of a spot token: total minus what open orders hold. */
function freeToken(state: unknown, token: number) {
  const balances = (state as { balances?: unknown } | null)?.balances;
  const entry = (Array.isArray(balances) ? balances : []).find((balance) => (balance as { token?: unknown }).token === token) as
    | { total?: unknown; hold?: unknown }
    | undefined;
  return Math.max(0, (Number(entry?.total) || 0) - (Number(entry?.hold) || 0));
}

export async function loadHlSpotAccount(user: `0x${string}`, market: BookSpotMarket): Promise<HlSpotAccount> {
  const [spot, abstraction, perps] = await Promise.all([
    info<unknown>({ type: "spotClearinghouseState", user }),
    info<unknown>({ type: "userAbstraction", user }).catch(() => null),
    info<{ withdrawable?: string }>({ type: "clearinghouseState", user }).catch(() => null),
  ]);
  const spotUsdc = readSpotUsdc(spot);
  const perpsAvailable = Number(perps?.withdrawable) || 0;
  // Unified (and portfolio-margin) accounts share one USDC balance across perps and spot.
  const unified = typeof abstraction === "string" && abstraction !== "default" && abstraction !== "disabled";
  return { spendable: unified ? spotUsdc + perpsAvailable : spotUsdc, spotUsdc, perpsAvailable, unified, base: freeToken(spot, market.baseToken) };
}

export type BookSpotOrder = { side: "buy"; usd: number } | { side: "sell"; base: number };

export interface BookSpotFill {
  filledSize: number;
  avgPx: number;
  /** Our builder fee on the fill, in bps. */
  partnerFeeBps: number;
}

/** Market order: an IOC limit at mid ± 5% (spot price rule: 8 - szDecimals decimals), with our builder fee. */
export async function placeHlSpotOrder(user: `0x${string}`, market: BookSpotMarket, order: BookSpotOrder): Promise<BookSpotFill> {
  if (market.venue !== "hyperliquid") throw new VenueError(`${market.base} isn't a Hyperliquid spot market.`);
  const { agent, builder } = requireTradingSetup(user);
  const isBuy = order.side === "buy";
  try {
    const mids = await info<Record<string, string>>({ type: "allMids" });
    const mid = Number(mids[market.coin]) || market.price;
    if (!mid || !(mid > 0)) throw new VenueError(`No price for ${market.base} on Hyperliquid right now.`);
    const size = roundSize(order.side === "buy" ? order.usd / mid : order.base, market.szDecimals);
    if (!(size > 0) || size * mid < HL_SPOT_MIN_ORDER_USD) throw new VenueError(`Order is too small. Hyperliquid's minimum is $${HL_SPOT_MIN_ORDER_USD}.`);
    const exchange = await agentExchange(agent.privateKey);
    const result = await exchange.order({
      orders: [
        {
          a: market.assetId,
          b: isBuy,
          p: toWire(slippagePrice(mid, isBuy, DEFAULT_SLIPPAGE, market.szDecimals, true)),
          s: toWire(size),
          r: false,
          t: { limit: { tif: "Ioc" } },
        },
      ],
      grouping: "na",
      builder: { b: builder.address, f: vipFee(builder.fee) },
    });
    const status = result.response.data.statuses[0];
    if (typeof status === "object" && "filled" in status) {
      return { filledSize: Number(status.filled.totalSz), avgPx: Number(status.filled.avgPx), partnerFeeBps: vipFee(builder.fee) / 10 };
    }
    throw new VenueError("Hyperliquid accepted the order but returned no fill.");
  } catch (error) {
    throw toVenueError(error);
  }
}

export interface BookSpotLimit {
  side: "buy" | "sell";
  /** Base size. */
  base: number;
  price: number;
}

export type BookSpotPlaced = ({ status: "filled" } & BookSpotFill) | { status: "resting"; oid: number };

/** Limit order (GTC) at the price, rounded to the spot price rule; it fills right away when it crosses the book. */
export async function placeHlSpotLimit(user: `0x${string}`, market: BookSpotMarket, order: BookSpotLimit): Promise<BookSpotPlaced> {
  if (market.venue !== "hyperliquid") throw new VenueError(`${market.base} isn't a Hyperliquid spot market.`);
  const { agent, builder } = requireTradingSetup(user);
  const size = roundSize(order.base, market.szDecimals);
  const price = roundPrice(order.price, market.szDecimals, true);
  if (!(size > 0) || !(price > 0)) throw new VenueError("Enter a price and a size.");
  if (size * price < HL_SPOT_MIN_ORDER_USD) throw new VenueError(`Order is too small. Hyperliquid's minimum is $${HL_SPOT_MIN_ORDER_USD}.`);
  try {
    const exchange = await agentExchange(agent.privateKey);
    const result = await exchange.order({
      orders: [{ a: market.assetId, b: order.side === "buy", p: toWire(price), s: toWire(size), r: false, t: { limit: { tif: "Gtc" } } }],
      grouping: "na",
      builder: { b: builder.address, f: vipFee(builder.fee) },
    });
    const status = result.response.data.statuses[0];
    if (typeof status === "object" && "resting" in status) return { status: "resting", oid: status.resting.oid };
    if (typeof status === "object" && "filled" in status) {
      return { status: "filled", filledSize: Number(status.filled.totalSz), avgPx: Number(status.filled.avgPx), partnerFeeBps: vipFee(builder.fee) / 10 };
    }
    throw new VenueError("Hyperliquid accepted the order but didn't say whether it rests or filled.");
  } catch (error) {
    throw toVenueError(error);
  }
}

/** The market's resting orders for the wallet. */
export async function loadHlSpotOpenOrders(user: `0x${string}`, market: BookSpotMarket): Promise<BookSpotOpenOrder[]> {
  return readHlSpotOpenOrders(await info<unknown>({ type: "openOrders", user }), market.coin);
}

export async function cancelHlSpotOrder(user: `0x${string}`, market: BookSpotMarket, oid: number) {
  const { agent } = requireTradingSetup(user);
  try {
    await (await agentExchange(agent.privateKey)).cancel({ cancels: [{ a: market.assetId, o: oid }] });
  } catch (error) {
    throw toVenueError(error);
  }
}
