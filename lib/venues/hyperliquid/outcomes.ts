"use client";

import { hip4AssetId } from "@/lib/prediction/hip4";
import { contractsFor, outcomeMarketPrice, outcomeOrderError, readOutcomeHoldings, readSpotUsdc } from "@/lib/prediction/hip4-trade";
import { VenueError } from "../types";
import { agentExchange, userExchange } from "./clients";
import { hlConfig } from "./config";
import { toVenueError } from "./errors";
import { toWire } from "./pricing";
import { requireTradingSetup } from "./venue";
import type { AbstractWallet } from "@nktkas/hyperliquid/signing";
import { vipFee } from "@/lib/profile/vip";

/**
 * HIP-4 outcome trading with the same Hyperliquid account, agent key and builder fee as perps. Outcomes are spot-like
 * assets: they spend spot USDC (or the shared balance of a unified account) and land as `+N` balances.
 */

async function info<T>(body: unknown): Promise<T> {
  const response = await fetch(`${hlConfig.apiUrl}/info`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new VenueError(`Hyperliquid answered ${response.status}.`);
  return (await response.json()) as T;
}

export interface OutcomeAccount {
  /** USDC an outcome buy can spend: spot USDC, or the perp margin too on a unified account. */
  spendable: number;
  /** Spot USDC alone (what a standard account must top up from perps). */
  spotUsdc: number;
  unified: boolean;
  holdings: ReturnType<typeof readOutcomeHoldings>;
}

export async function loadOutcomeAccount(user: `0x${string}`): Promise<OutcomeAccount> {
  const [spot, abstraction, perps] = await Promise.all([
    info<unknown>({ type: "spotClearinghouseState", user }),
    info<unknown>({ type: "userAbstraction", user }).catch(() => null),
    info<{ withdrawable?: string }>({ type: "clearinghouseState", user }).catch(() => null),
  ]);
  const spotUsdc = readSpotUsdc(spot);
  // Unified (and portfolio-margin) accounts share one USDC balance across perps, spot and outcomes.
  const unified = typeof abstraction === "string" && abstraction !== "default" && abstraction !== "disabled";
  return { spendable: unified ? spotUsdc + (Number(perps?.withdrawable) || 0) : spotUsdc, spotUsdc, unified, holdings: readOutcomeHoldings(spot) };
}

export type OutcomeOrder =
  | { side: "buy"; coin: string; usd: number; reference: number }
  | { side: "sell"; coin: string; contracts: number; reference: number };

export interface OutcomeFill {
  status: "filled" | "resting";
  contracts: number;
  avgPx: number;
}

/**
 * Market order on an outcome coin (`#N`): an IOC limit at the book's edge ± 5¢, whole contracts, with our builder
 * fee. `reference` is the best ask for buys and the best bid for sells.
 */
export async function placeOutcomeOrder(user: `0x${string}`, order: OutcomeOrder): Promise<OutcomeFill> {
  const { agent, builder } = requireTradingSetup(user);
  const asset = hip4AssetId(order.coin);
  if (asset === null) throw new VenueError("Unknown outcome.");
  if (!(order.reference > 0 && order.reference < 1)) throw new VenueError("This outcome has no price on the book right now.");
  const isBuy = order.side === "buy";
  const price = outcomeMarketPrice(order.reference, isBuy);
  const contracts = isBuy ? contractsFor(order.usd, order.reference) : Math.floor(order.contracts);
  const invalid = outcomeOrderError(contracts, order.reference);
  if (invalid) throw new VenueError(invalid);
  try {
    const exchange = await agentExchange(agent.privateKey);
    const result = await exchange.order({
      orders: [{ a: asset, b: isBuy, p: toWire(price), s: toWire(contracts), r: false, t: { limit: { tif: "Ioc" } } }],
      grouping: "na",
      builder: { b: builder.address, f: vipFee(builder.fee) },
    });
    const status = result.response.data.statuses[0];
    if (typeof status === "object" && "filled" in status) return { status: "filled", contracts: Number(status.filled.totalSz), avgPx: Number(status.filled.avgPx) };
    if (typeof status === "object" && "resting" in status) return { status: "resting", contracts, avgPx: price };
    throw new VenueError("Hyperliquid accepted the order but returned no fill.");
  } catch (error) {
    throw toVenueError(error);
  }
}

/** Moves USDC from perps to spot so a standard account can buy outcomes. Signed by the user's wallet, not the agent. */
export async function moveUsdcToSpot(wallet: AbstractWallet, usd: number) {
  try {
    const exchange = await userExchange(wallet);
    await exchange.usdClassTransfer({ amount: toWire(Math.ceil(usd * 100) / 100), toPerp: false });
  } catch (error) {
    throw toVenueError(error);
  }
}
