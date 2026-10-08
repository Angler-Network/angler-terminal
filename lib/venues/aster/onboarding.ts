"use client";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { WalletClient } from "viem";
import { bsc } from "viem/chains";
import { VenueError } from "../types";
import { asterConfig } from "./config";
import { asterNonce, walletParams, walletTypedData, type AsterParams } from "./sign";

/**
 * Aster setup for a wallet, all signed by the wallet itself (typed data on BNB Chain's id, as Aster's demo does):
 * 1. approve our builder fee (when one is configured), 2. approve an agent key made in this browser that can trade
 * perps but never withdraw. The key lives in this browser's localStorage only, like the Hyperliquid agent.
 */

export interface AsterAgent {
  address: `0x${string}`;
  privateKey: `0x${string}`;
}

export interface AsterRecord {
  agent?: AsterAgent;
  /** The builder and cap this wallet approved. */
  builder?: { address: string; maxFeeRate: number };
}

export interface AsterOnboarding {
  agentReady: boolean;
  builder: "none" | "needed" | "approved";
}

const KEY = "angler:aster:mainnet";
const storageKey = (user: string) => `${KEY}:${user.toLowerCase()}`;
/** Agents are approved for about ten years; revoking is a new setup. */
const AGENT_LIFETIME_MS = 10 * 365 * 86_400_000;

function storage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readAsterRecord(user: string): AsterRecord {
  try {
    const parsed = JSON.parse(storage()?.getItem(storageKey(user)) ?? "{}") as AsterRecord;
    const agent = parsed.agent && /^0x[0-9a-fA-F]{40}$/.test(parsed.agent.address) && /^0x[0-9a-fA-F]{64}$/.test(parsed.agent.privateKey) ? parsed.agent : undefined;
    return { agent, builder: parsed.builder && typeof parsed.builder.address === "string" ? parsed.builder : undefined };
  } catch {
    return {};
  }
}

function writeRecord(user: string, record: AsterRecord) {
  const store = storage();
  if (!store) return;
  if (!record.agent && !record.builder) store.removeItem(storageKey(user));
  else store.setItem(storageKey(user), JSON.stringify(record));
}

export function asterOnboarding(user: string): AsterOnboarding {
  const record = readAsterRecord(user);
  const builder = asterConfig.builder;
  const builderState = !builder
    ? "none"
    : record.builder?.address.toLowerCase() === builder.address.toLowerCase() && record.builder.maxFeeRate >= builder.feeRate
      ? "approved"
      : "needed";
  return { agentReady: Boolean(record.agent), builder: builderState };
}

/** The agent key to sign orders with, or null before setup. */
export function asterAgent(user: string) {
  const agent = readAsterRecord(user).agent;
  return agent ? privateKeyToAccount(agent.privateKey) : null;
}

/** Sends a wallet-signed account action as Aster's demo does: form body with the signature and its chain. */
async function sendWalletAction(wallet: WalletClient, user: `0x${string}`, path: string, primaryType: string, action: AsterParams) {
  const params = walletParams(action, user, asterNonce());
  const typed = walletTypedData(primaryType, params);
  // Some wallets refuse typed data for another chain than the one they're on: move to BNB Chain first.
  if ((await wallet.getChainId().catch(() => bsc.id)) !== bsc.id) await wallet.switchChain({ id: bsc.id }).catch(() => undefined);
  const signature = await wallet.signTypedData({ ...(typed as unknown as Parameters<WalletClient["signTypedData"]>[0]), account: user });
  const body = new URLSearchParams(Object.entries({ ...params, signature, signatureChainId: bsc.id }).map(([key, value]) => [key, String(value)]));
  const response = await fetch(`${asterConfig.apiUrl}${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const result = (await response.json().catch(() => ({}))) as { code?: number; msg?: string };
  if (!response.ok || (typeof result.code === "number" && result.code !== 200 && result.code !== 0)) {
    throw new VenueError(result.msg ? `Aster: ${result.msg}` : `Aster answered ${response.status}.`);
  }
}

export async function approveAsterBuilder(wallet: WalletClient, user: `0x${string}`) {
  const builder = asterConfig.builder;
  if (!builder) return;
  await sendWalletAction(wallet, user, "/fapi/v3/approveBuilder", "ApproveBuilder", {
    builder: builder.address,
    maxFeeRate: String(builder.maxFeeRate),
    builderName: "Angler",
  });
  writeRecord(user, { ...readAsterRecord(user), builder: { address: builder.address, maxFeeRate: builder.maxFeeRate } });
}

export async function approveAsterAgent(wallet: WalletClient, user: `0x${string}`) {
  const privateKey = generatePrivateKey();
  const agent = privateKeyToAccount(privateKey);
  await sendWalletAction(wallet, user, "/fapi/v3/approveAgent", "ApproveAgent", {
    agentName: "Angler",
    agentAddress: agent.address,
    ipWhitelist: "",
    expired: Date.now() + AGENT_LIFETIME_MS,
    canSpotTrade: false,
    canPerpTrade: true,
    canWithdraw: false,
  });
  writeRecord(user, { ...readAsterRecord(user), agent: { address: agent.address, privateKey } });
  return agent.address;
}

/** Forgets the key here (it can't withdraw; Aster lets it expire or be removed from the Aster app). */
export function forgetAsterAgent(user: string) {
  const record = readAsterRecord(user);
  writeRecord(user, { ...record, agent: undefined });
}
