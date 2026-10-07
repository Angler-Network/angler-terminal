"use client";

import { readLighterSpotMarkets, type BookSpotMarket, type BookSpotOpenOrder } from "@/lib/spot/book-spot";
import { VenueError } from "../types";
import { readOpenOrder, readOrderOutcome } from "./account";
import { accountOrders, bestPrices, getAccountIndex, lighterGet, txStatus } from "./api";
import { DEFAULT_SLIPPAGE, lighterConfig } from "./config";
import { humanizeLighterStatus, LighterApiError, toLighterVenueError } from "./errors";
import { baseAmountFor, fromUnits, minimumSize, nextClientOrderIndex, toUnits, worstPrice } from "./pricing";
import { authToken, loadSession, requireSession, signAndSend, waitForTx } from "./session";
import { ROUTE, signCancelOrder, signCreateOrder, signTransfer } from "./signer";

/**
 * Lighter spot (core Lighter only): the same account, trading key and nonces as perps, but spot balances live on the
 * account's spot route, apart from the perps margin. A buy spends spot USDC, so USDC moves perps → spot first (a
 * transfer to the same account, signed with the trading key; no wallet signature). Orders carry no integrator fee:
 * the user's integrator approval covers perps only.
 */

const config = lighterConfig;
/** USDC has 6 decimals on Lighter. */
const USDC_DECIMALS = 6;
const CONFIRM_TIMEOUT_MS = 15_000;
const CONFIRM_INTERVAL_MS = 600;
/** Limit orders rest up to 28 days, like the perp ones. */
const LIMIT_EXPIRY_MS = 28 * 24 * 3600 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let lastClientOrderIndex = 0;

export async function loadLighterSpotMarket(id: number): Promise<BookSpotMarket | null> {
  const markets = readLighterSpotMarkets(await lighterGet(config, "orderBookDetails", { filter: "spot" }));
  return markets.find((market) => market.id === id) ?? null;
}

export interface LighterSpotAccount {
  /** False until the wallet's first deposit opens a Lighter account. */
  exists: boolean;
  /** Free USDC on the spot route. */
  spotUsdc: number;
  /** USDC the perps side could move to spot. */
  perpsAvailable: number;
  /** Free balance of the market's base asset. */
  base: number;
}

interface LighterAsset {
  asset_id?: unknown;
  balance?: unknown;
  locked_balance?: unknown;
}

function free(assets: LighterAsset[], assetId: number | undefined) {
  const asset = assets.find((entry) => Number(entry.asset_id) === assetId);
  return Math.max(0, (Number(asset?.balance) || 0) - (Number(asset?.locked_balance) || 0));
}

export async function loadLighterSpotAccount(user: string, market: BookSpotMarket): Promise<LighterSpotAccount> {
  const accountIndex = await getAccountIndex(config, user);
  if (accountIndex === null) return { exists: false, spotUsdc: 0, perpsAvailable: 0, base: 0 };
  const body = await lighterGet(config, "account", { by: "index", value: accountIndex });
  const account = (Array.isArray(body.accounts) ? body.accounts[0] : null) as { assets?: unknown; available_balance?: unknown } | null;
  const assets = Array.isArray(account?.assets) ? (account.assets as LighterAsset[]) : [];
  return {
    exists: true,
    spotUsdc: free(assets, market.quoteToken),
    perpsAvailable: Math.max(0, Number(account?.available_balance) || 0),
    base: free(assets, market.baseToken),
  };
}

export type BookSpotOrder = { side: "buy"; usd: number } | { side: "sell"; base: number };

export interface BookSpotFill {
  filledSize: number;
  avgPx: number;
}

/**
 * `sendTx` 200 is only "accepted": polls the order by its client index until it filled, rests (limit orders only;
 * a market order never rests) or was canceled.
 */
async function confirm(session: Awaited<ReturnType<typeof requireSession>>, clientIndex: number, hash: string, market: BookSpotMarket, canRest = false): Promise<BookSpotPlaced> {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  const auth = await authToken(session);
  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    await sleep(CONFIRM_INTERVAL_MS);
    const [order] = await accountOrders(config, session.accountIndex, [clientIndex], auth).catch(() => []);
    if (order) {
      const outcome = readOrderOutcome(order);
      if (outcome.state === "filled") return { status: "filled", filledSize: outcome.filledSize, avgPx: outcome.avgPx };
      if (outcome.state === "resting" && canRest) return { status: "resting", oid: outcome.orderIndex };
      if (outcome.state === "canceled") throw new VenueError(humanizeLighterStatus(outcome.status), outcome.status);
    } else if (attempt % 4 === 3) {
      const tx = await txStatus(config, hash).catch(() => null);
      if (tx?.status === 0) throw new LighterApiError(0, `Lighter rejected the ${market.base} order.`);
    }
  }
  throw new VenueError(`Lighter accepted the ${market.base} order but hasn't confirmed it yet. Check your balances before trying again.`);
}

/** Market order: IOC at the best ask/bid ± 3%, sized in base units (buys: the USD amount at the best ask). */
export async function placeLighterSpotOrder(user: string, market: BookSpotMarket, order: BookSpotOrder): Promise<BookSpotFill> {
  if (market.venue !== "lighter" || market.priceDecimals === undefined) throw new VenueError(`${market.base} isn't a Lighter spot market.`);
  const isBuy = order.side === "buy";
  try {
    const session = await requireSession(config, user);
    const book = await bestPrices(config, market.id);
    const reference = isBuy ? book.ask : book.bid;
    if (!reference) throw new VenueError(`Nobody is ${isBuy ? "selling" : "buying"} ${market.base} on Lighter right now.`);
    const size = order.side === "buy" ? order.usd / reference : order.base;
    const baseAmount = baseAmountFor(size, market.szDecimals);
    const minimum = minimumSize(market, reference);
    if (!(baseAmount > 0) || fromUnits(baseAmount, market.szDecimals) < minimum) {
      throw new VenueError(`Order is too small. Lighter's minimum for ${market.base} is ${minimum} (about $${Math.ceil(minimum * reference)}).`);
    }
    lastClientOrderIndex = nextClientOrderIndex(Date.now(), lastClientOrderIndex);
    const clientIndex = lastClientOrderIndex;
    const hash = await signAndSend(session, (nonce) =>
      signCreateOrder(
        session.signer,
        {
          marketIndex: market.id,
          clientOrderIndex: clientIndex,
          baseAmount,
          price: worstPrice(reference, isBuy, DEFAULT_SLIPPAGE, market.priceDecimals!),
          isAsk: !isBuy,
          orderType: 1,
          timeInForce: 0,
          reduceOnly: false,
          orderExpiry: 0,
        },
        nonce,
      ),
    );
    const placed = await confirm(session, clientIndex, hash, market);
    if (placed.status !== "filled") throw new VenueError(`Lighter left the ${market.base} order open.`);
    return placed;
  } catch (error) {
    throw toLighterVenueError(error);
  }
}

export type BookSpotPlaced = ({ status: "filled" } & BookSpotFill) | { status: "resting"; oid: number };

/** Limit order (GTT, 28 days) at the price; it fills right away when it crosses the book. */
export async function placeLighterSpotLimit(user: string, market: BookSpotMarket, order: { side: "buy" | "sell"; base: number; price: number }): Promise<BookSpotPlaced> {
  if (market.venue !== "lighter" || market.priceDecimals === undefined) throw new VenueError(`${market.base} isn't a Lighter spot market.`);
  try {
    const session = await requireSession(config, user);
    const baseAmount = baseAmountFor(order.base, market.szDecimals);
    const minimum = minimumSize(market, order.price);
    if (!(baseAmount > 0) || !(order.price > 0)) throw new VenueError("Enter a price and a size.");
    if (fromUnits(baseAmount, market.szDecimals) < minimum) {
      throw new VenueError(`Order is too small. Lighter's minimum for ${market.base} is ${minimum} (about ${Math.ceil(minimum * order.price)}).`);
    }
    lastClientOrderIndex = nextClientOrderIndex(Date.now(), lastClientOrderIndex);
    const clientIndex = lastClientOrderIndex;
    const hash = await signAndSend(session, (nonce) =>
      signCreateOrder(
        session.signer,
        {
          marketIndex: market.id,
          clientOrderIndex: clientIndex,
          baseAmount,
          price: toUnits(order.price, market.priceDecimals!, "round"),
          isAsk: order.side === "sell",
          orderType: 0,
          timeInForce: 1,
          reduceOnly: false,
          orderExpiry: Date.now() + LIMIT_EXPIRY_MS,
        },
        nonce,
      ),
    );
    return await confirm(session, clientIndex, hash, market, true);
  } catch (error) {
    throw toLighterVenueError(error);
  }
}

/** The market's resting orders; reading them needs the trading key's auth token, so none without a key here. */
export async function loadLighterSpotOpenOrders(user: string, market: BookSpotMarket): Promise<BookSpotOpenOrder[]> {
  const session = await loadSession(config, user).catch(() => null);
  if (!session) return [];
  const body = await lighterGet(config, "accountActiveOrders", { account_index: session.accountIndex, market_id: market.id }, await authToken(session));
  const orders = Array.isArray(body.orders) ? body.orders : [];
  return orders
    .flatMap((value) => {
      const order = readOpenOrder(value, (id) => (id === market.id ? market.coin : undefined));
      return order ? [{ oid: order.oid, side: order.side, price: order.limitPx, size: order.size, origSize: order.origSize, time: order.timestamp }] : [];
    })
    .sort((a, b) => b.time - a.time);
}

export async function cancelLighterSpotOrder(user: string, market: BookSpotMarket, oid: number) {
  try {
    const session = await requireSession(config, user);
    await signAndSend(session, (nonce) => signCancelOrder(session.signer, market.id, oid, nonce));
  } catch (error) {
    throw toLighterVenueError(error);
  }
}

/** Moves `usd` of USDC from the account's perps margin to its spot route. */
export async function moveLighterUsdcToSpot(user: string, market: BookSpotMarket, usd: number) {
  if (market.quoteToken === undefined) throw new VenueError("Unknown USDC asset on Lighter.");
  try {
    const session = await requireSession(config, user);
    const auth = await authToken(session);
    const fee = await lighterGet(config, "transferFeeInfo", { account_index: session.accountIndex, to_account_index: session.accountIndex }, auth)
      .then((body) => Number(body.transfer_fee_usdc) || 0)
      .catch(() => 0);
    const hash = await signAndSend(session, (nonce) =>
      signTransfer(
        session.signer,
        {
          toAccountIndex: session.accountIndex,
          assetIndex: market.quoteToken!,
          fromRoute: ROUTE.perps,
          toRoute: ROUTE.spot,
          amount: toUnits(Math.ceil(usd * 100) / 100, USDC_DECIMALS, "ceil"),
          usdcFee: fee,
        },
        nonce,
      ),
    );
    await waitForTx(config, hash);
  } catch (error) {
    throw toLighterVenueError(error);
  }
}
