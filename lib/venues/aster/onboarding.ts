"use client";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { WalletClient } from "viem";
import { bsc } from "viem/chains";
import { VenueError } from "../types";
import { asterConfig } from "./config";
import { asterNonce, signAgentRequest, walletParams, walletTypedData, type AsterParams } from "./sign";
import { readAsterRecord, writeAsterRecord } from "./store";

/**
 * Aster setup for a wallet, all signed by the wallet itself (typed data on BNB Chain's id, as Aster's demo does):
 * 1. approve our builder fee (when one is configured), 2. approve an agent key made in this browser that can trade
 * perps but never withdraw. The key lives in this browser's localStorage only, like the Hyperliquid agent. Loaded on
 * demand (viem's accounts and secp256k1); what the first screen needs to know about a wallet is in `store.ts`.
 */

/** Agents are approved for about ten years; revoking is a new setup. */
const AGENT_LIFETIME_MS = 10 * 365 * 86_400_000;

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
  writeAsterRecord(user, { ...readAsterRecord(user), builder: { address: builder.address, maxFeeRate: builder.maxFeeRate } });
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
  writeAsterRecord(user, { ...readAsterRecord(user), agent: { address: agent.address, privateKey } });
  // Deposits arrive as USDC: Multi-Assets mode lets it count as margin for the USDT markets. Aster refuses while an
  // isolated position is open (or when it's already on); then nothing changes.
  try {
    const query = await signAgentRequest(agent, user, { multiAssetsMargin: "true" });
    await fetch(`${asterConfig.apiUrl}/fapi/v3/multiAssetsMargin`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: query });
  } catch {}
  return agent.address;
}

