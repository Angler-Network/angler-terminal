"use client";

import type { EIP1193Provider } from "viem";
import { VenueError } from "../types";
import { orderlyConfig } from "./config";
import { orderlyKey } from "./onboarding";
import { orderlyHeaders } from "./sign";

/**
 * Withdraws USDC from the wallet's Orderly account to the wallet on Arbitrum (Sepolia on testnet). The wallet signs an
 * EIP-712 `Withdraw` on the on-chain domain (verifying contract: Orderly's ledger), the request itself is signed by
 * the trading key. Amounts are USDC base units (6 decimals): checked on testnet, where "5000000" was read as 5 USDC
 * and "5" refused. Orderly charges its withdrawal fee (1 USDC on Arbitrum) and pays out in a few minutes.
 */

export const ORDERLY_LEDGER: Record<"mainnet" | "testnet", `0x${string}`> = {
  mainnet: "0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203",
  testnet: "0x1826B75e2ef249173FC735149AE4B8e9ea10abff",
};

export const ORDERLY_WITHDRAW_FEE_USDC = 1;

const WITHDRAW_TYPES = {
  Withdraw: [
    { name: "brokerId", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "receiver", type: "address" },
    { name: "token", type: "string" },
    { name: "amount", type: "uint256" },
    { name: "withdrawNonce", type: "uint64" },
    { name: "timestamp", type: "uint64" },
  ],
} as const;

async function signedCall<T>(user: `0x${string}`, method: "GET" | "POST", path: string, payload?: unknown): Promise<T> {
  const key = orderlyKey(user);
  if (!key) throw new VenueError("Set up Orderly trading first (its trading key signs withdrawals too).");
  const { accountId, secret } = await key;
  const body = payload ? JSON.stringify(payload) : "";
  const response = await fetch(`${orderlyConfig.apiUrl}${path}`, { method, cache: "no-store", headers: orderlyHeaders(secret, accountId, Date.now(), method, path, body), body: body || undefined });
  const result = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; data?: T };
  if (!result.success) throw new VenueError(result.message ? `Orderly: ${result.message}` : `Orderly answered ${response.status}.`);
  return result.data as T;
}

export async function withdrawOrderly(provider: EIP1193Provider, account: `0x${string}`, units: bigint) {
  const brokerId = orderlyConfig.brokerId;
  if (!brokerId) throw new VenueError("Orderly isn't set up on this site yet.");
  if (units <= BigInt(ORDERLY_WITHDRAW_FEE_USDC) * 1_000_000n) throw new VenueError(`Withdraw more than Orderly's ${ORDERLY_WITHDRAW_FEE_USDC} USDC fee.`);
  const [{ createWalletClient, custom }, { arbitrum, arbitrumSepolia }] = await Promise.all([import("viem"), import("viem/chains")]);
  const chain = orderlyConfig.network === "mainnet" ? arbitrum : arbitrumSepolia;
  const wallet = createWalletClient({ account, chain, transport: custom(provider) });
  if ((await wallet.getChainId()) !== chain.id) {
    try {
      await wallet.switchChain({ id: chain.id });
    } catch {
      await wallet.addChain({ chain });
      await wallet.switchChain({ id: chain.id });
    }
  }
  const { withdraw_nonce: nonce } = await signedCall<{ withdraw_nonce: number | string }>(account, "GET", "/v1/withdraw_nonce");
  const timestamp = Date.now();
  const verifyingContract = ORDERLY_LEDGER[orderlyConfig.network];
  const message = { brokerId, chainId: chain.id, receiver: account, token: "USDC", amount: units.toString(), withdrawNonce: String(nonce), timestamp: String(timestamp) };
  const signature = await wallet.signTypedData({
    account,
    domain: { name: "Orderly", version: "1", chainId: chain.id, verifyingContract },
    types: WITHDRAW_TYPES,
    primaryType: "Withdraw",
    message: { ...message, chainId: BigInt(chain.id), amount: units, withdrawNonce: BigInt(nonce), timestamp: BigInt(timestamp) },
  });
  await signedCall(account, "POST", "/v1/withdraw_request", { message, signature, userAddress: account, verifyingContract });
}
