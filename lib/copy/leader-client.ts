"use client";

import { hlConfig } from "@/lib/venues/hyperliquid/config";
import { readAccountIndex, readPosition } from "@/lib/venues/lighter/account";
import { lighterConfigs } from "@/lib/venues/lighter/config";
import type { LeaderPosition } from "./events";
import type { FollowSource } from "./follows";

/**
 * A followed wallet's open positions and recent trades, read from the browser over the venues' public APIs (each
 * visitor spends their own IP's allowance). Hyperliquid by address on the main and listed HIP-3 dexes; Lighter by the
 * address's account.
 */

export interface LeaderSnapshot {
  positions: Record<string, LeaderPosition & { unrealizedPnl: number; leverage: number | null }>;
  accountValue: number | null;
}

export interface LeaderFill {
  coin: string;
  side: "buy" | "sell";
  size: number;
  price: number;
  time: number;
  /** "Open Long", "Close Short"… as Hyperliquid names it. */
  dir: string;
  closedPnl: number;
}

const HL_DEXES = ["", ...hlConfig.hip3Dexes];

async function hlInfo<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${hlConfig.apiUrl}/info`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Hyperliquid answered ${response.status}.`);
  return (await response.json()) as T;
}

type HlState = {
  marginSummary?: { accountValue?: string };
  assetPositions?: Array<{ position: { coin: string; szi: string; entryPx: string; positionValue: string; unrealizedPnl: string; leverage?: { value?: number } } }>;
};

/** Hyperliquid `clearinghouseState` → positions by coin. */
export function readHlLeader(states: HlState[]): LeaderSnapshot {
  const positions: LeaderSnapshot["positions"] = {};
  let accountValue: number | null = null;
  for (const state of states) {
    const value = Number(state.marginSummary?.accountValue);
    if (Number.isFinite(value)) accountValue = (accountValue ?? 0) + value;
    for (const { position } of state.assetPositions ?? []) {
      const size = Number(position.szi);
      if (!size) continue;
      positions[position.coin] = {
        coin: position.coin,
        size,
        entryPx: Number(position.entryPx),
        markPx: Math.abs(Number(position.positionValue) / size),
        unrealizedPnl: Number(position.unrealizedPnl),
        leverage: Number(position.leverage?.value) || null,
      };
    }
  }
  return { positions, accountValue };
}

const accountIndexes = new Map<string, number | null>();

async function lighterGet(source: Exclude<FollowSource, "hyperliquid">, path: string, params: Record<string, string>) {
  const response = await fetch(`${lighterConfigs[source].apiUrl}/api/v1/${path}?${new URLSearchParams(params)}`);
  if (!response.ok && response.status !== 400 && response.status !== 404) throw new Error(`Lighter answered ${response.status}.`);
  return (await response.json()) as Record<string, unknown>;
}

export async function loadLeader(source: FollowSource, address: string): Promise<LeaderSnapshot> {
  if (source === "hyperliquid") {
    const states = await Promise.all(HL_DEXES.map((dex) => hlInfo<HlState>(dex ? { type: "clearinghouseState", user: address, dex } : { type: "clearinghouseState", user: address })));
    return readHlLeader(states);
  }
  const key = `${source}:${address}`;
  if (!accountIndexes.has(key)) accountIndexes.set(key, readAccountIndex(await lighterGet(source, "accountsByL1Address", { l1_address: address })));
  const index = accountIndexes.get(key);
  if (index === null || index === undefined) return { positions: {}, accountValue: null };
  const body = await lighterGet(source, "account", { by: "index", value: String(index) });
  const account = Array.isArray(body.accounts) ? (body.accounts[0] as Record<string, unknown> | undefined) : undefined;
  const positions: LeaderSnapshot["positions"] = {};
  for (const value of Array.isArray(account?.positions) ? account.positions : []) {
    const position = readPosition(value);
    if (!position) continue;
    positions[position.coin] = {
      coin: position.coin,
      size: position.size,
      entryPx: position.entryPx,
      markPx: position.positionValue / Math.abs(position.size),
      unrealizedPnl: position.unrealizedPnl,
      leverage: position.leverage || null,
    };
  }
  const value = Number(account?.total_asset_value);
  return { positions, accountValue: Number.isFinite(value) ? value : null };
}

type HlFill = { coin: string; side: "B" | "A"; sz: string; px: string; time: number; dir: string; closedPnl: string };

/** Hyperliquid's latest fills of the address (Lighter's trade history needs the account's own key). */
export async function loadLeaderFills(source: FollowSource, address: string, limit = 12): Promise<LeaderFill[] | null> {
  if (source !== "hyperliquid") return null;
  const fills = await hlInfo<HlFill[]>({ type: "userFills", user: address });
  return fills.slice(0, limit).map((fill) => ({
    coin: fill.coin,
    side: fill.side === "B" ? "buy" : "sell",
    size: Number(fill.sz),
    price: Number(fill.px),
    time: fill.time,
    dir: fill.dir,
    closedPnl: Number(fill.closedPnl),
  }));
}
