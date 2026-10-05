"use client";

import type { EIP1193Provider } from "viem";
import { VenueError } from "./types";
import { lighterConfig } from "./lighter/config";
import type { SourceChain } from "./deposits";

/** On-chain USDC moves for deposits. viem loads on first use, not with the page. */

const RPC_URLS: Record<number, string> = { 42161: "https://arb1.arbitrum.io/rpc", 8453: "https://mainnet.base.org" };

async function chainFor(source: SourceChain) {
  const { arbitrum, base } = await import("viem/chains");
  return source.chainId === base.id ? base : arbitrum;
}

export async function readUsdcBalance(source: SourceChain, owner: `0x${string}`) {
  const { createPublicClient, erc20Abi, http } = await import("viem");
  const client = createPublicClient({ chain: await chainFor(source), transport: http(RPC_URLS[source.chainId]) });
  return client.readContract({ address: source.usdc, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

/** Lighter's CCTP intent address for this wallet and chain: USDC sent there is credited to the wallet's Lighter account. */
export async function lighterIntentAddress(source: SourceChain, owner: `0x${string}`) {
  const response = await fetch(`${lighterConfig.apiUrl}/api/v1/createIntentAddress`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ chain_id: String(source.chainId), from_addr: owner, amount: "0", is_external_deposit: "true" }),
  });
  const body = (await response.json().catch(() => ({}))) as { intent_address?: string; message?: string };
  if (!response.ok || !body.intent_address || !/^0x[0-9a-fA-F]{40}$/.test(body.intent_address)) {
    throw new VenueError(body.message ?? "Lighter didn't return a deposit address.");
  }
  return body.intent_address as `0x${string}`;
}

/** Sends USDC on the source chain (switching the wallet to it first) and waits for the receipt. */
export async function sendUsdc(provider: EIP1193Provider, account: `0x${string}`, source: SourceChain, to: `0x${string}`, units: bigint) {
  const { createPublicClient, createWalletClient, custom, erc20Abi, http } = await import("viem");
  const chain = await chainFor(source);
  const wallet = createWalletClient({ account, chain, transport: custom(provider) });
  if ((await wallet.getChainId()) !== chain.id) {
    try {
      await wallet.switchChain({ id: chain.id });
    } catch {
      await wallet.addChain({ chain });
    }
  }
  const hash = await wallet.writeContract({ address: source.usdc, abi: erc20Abi, functionName: "transfer", args: [to, units] });
  const receipt = await createPublicClient({ chain, transport: http(RPC_URLS[source.chainId]) }).waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new VenueError("The USDC transfer reverted.");
  return { hash, explorerUrl: `${source.explorer}/tx/${hash}` };
}
