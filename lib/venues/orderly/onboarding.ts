"use client";

import type { WalletClient } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";
import { encryptSecret, getDeviceKey } from "../lighter/key-crypto";
import { VenueError } from "../types";
import { orderlyConfig } from "./config";
import { ADD_KEY_TYPES, REGISTRATION_TYPES, newOrderlyKey, offchainDomain, orderlyAccountId } from "./sign";
import { readOrderlyRecord, writeOrderlyRecord, type OrderlyOnboarding, type OrderlyRecord } from "./store";

/**
 * Orderly setup for a wallet, each step one wallet signature (EIP-712, on Arbitrum where deposits go):
 * 1. register the account under our broker id (once per wallet and broker, for good);
 * 2. add a trading key made in this browser (ed25519, scope read + trading: it can't withdraw), valid a year.
 * The key's secret is kept AES-GCM encrypted with this browser's non-extractable device key (the same one Lighter's
 * key uses), never in plain text, and is never logged or sent. Loaded on demand (viem, ed25519); the saved key and
 * its readers are in `store.ts`.
 */

const KEY_LIFETIME_MS = 365 * 86_400_000;
function brokerId() {
  if (!orderlyConfig.brokerId) throw new VenueError("Orderly isn't set up on this site yet.");
  return orderlyConfig.brokerId;
}

async function api<T>(path: string, init?: RequestInit): Promise<{ success: boolean; code?: number; message?: string; data?: T }> {
  const response = await fetch(`${orderlyConfig.apiUrl}${path}`, { cache: "no-store", ...init });
  return (await response.json().catch(() => ({ success: false, message: `Orderly answered ${response.status}.` }))) as { success: boolean; code?: number; message?: string; data?: T };
}

/** Whether the wallet already has an account under our broker (Orderly answers -1607 "Account not found" otherwise). */
export async function orderlyRegistered(user: `0x${string}`) {
  const result = await api<{ account_id: string }>(`/v1/get_account?address=${user}&broker_id=${brokerId()}`);
  return result.success && Boolean(result.data?.account_id);
}

export async function orderlyOnboarding(user: `0x${string}`): Promise<OrderlyOnboarding> {
  const record = readOrderlyRecord(user);
  const registered = record ? true : await orderlyRegistered(user).catch(() => null);
  return { registered, keyReady: Boolean(record), accountId: record?.accountId ?? (registered ? orderlyAccountId(user, brokerId()) : null) };
}

/** Moves the wallet to the chain Orderly's typed data names (most wallets refuse typed data for another chain). */
async function onSignChain(wallet: WalletClient) {
  const chain = orderlyConfig.network === "mainnet" ? arbitrum : arbitrumSepolia;
  if ((await wallet.getChainId().catch(() => 0)) === chain.id) return;
  try {
    await wallet.switchChain({ id: chain.id });
  } catch {
    await wallet.addChain({ chain }).catch(() => undefined);
    await wallet.switchChain({ id: chain.id });
  }
}

export async function registerOrderly(wallet: WalletClient, user: `0x${string}`) {
  if (await orderlyRegistered(user)) return orderlyAccountId(user, brokerId());
  await onSignChain(wallet);
  const nonce = await api<{ registration_nonce: string }>("/v1/registration_nonce");
  if (!nonce.success || !nonce.data) throw new VenueError(nonce.message ?? "Orderly didn't give a registration nonce.");
  const message = { brokerId: brokerId(), chainId: orderlyConfig.signChainId, timestamp: Date.now(), registrationNonce: nonce.data.registration_nonce };
  const signature = await wallet.signTypedData({
    account: user,
    domain: offchainDomain(orderlyConfig.signChainId),
    types: REGISTRATION_TYPES,
    primaryType: "Registration",
    message: { ...message, chainId: BigInt(message.chainId), timestamp: BigInt(message.timestamp), registrationNonce: BigInt(message.registrationNonce) },
  });
  const result = await api<{ account_id: string }>("/v1/register_account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature, userAddress: user }),
  });
  if (!result.success) throw new VenueError(result.message ? `Orderly: ${result.message}` : "Orderly didn't register the account.");
  return result.data?.account_id ?? orderlyAccountId(user, brokerId());
}

export async function addOrderlyKey(wallet: WalletClient, user: `0x${string}`) {
  await onSignChain(wallet);
  const key = newOrderlyKey();
  const timestamp = Date.now();
  const message = {
    brokerId: brokerId(),
    chainId: orderlyConfig.signChainId,
    orderlyKey: key.publicKey,
    scope: "read,trading",
    timestamp,
    expiration: timestamp + KEY_LIFETIME_MS,
  };
  const signature = await wallet.signTypedData({
    account: user,
    domain: offchainDomain(orderlyConfig.signChainId),
    types: ADD_KEY_TYPES,
    primaryType: "AddOrderlyKey",
    message: { ...message, chainId: BigInt(message.chainId), timestamp: BigInt(message.timestamp), expiration: BigInt(message.expiration) },
  });
  const result = await api("/v1/orderly_key", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature, userAddress: user }) });
  if (!result.success) throw new VenueError(result.message ? `Orderly: ${result.message}` : "Orderly didn't accept the trading key.");
  const record: OrderlyRecord = {
    accountId: orderlyAccountId(user, brokerId()),
    publicKey: key.publicKey,
    secret: await encryptSecret(await getDeviceKey(), key.secret),
    expiration: message.expiration,
  };
  writeOrderlyRecord(user, record);
}

