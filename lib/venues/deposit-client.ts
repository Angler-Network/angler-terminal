"use client";

import type { EIP1193Provider } from "viem";
import { VenueError } from "./types";
import type { LighterConfig } from "./lighter/config";
import type { SourceChain } from "./deposits";

/** On-chain USDC moves for deposits. viem loads on first use, not with the page. */

const RPC_URLS: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com",
  42161: "https://arb1.arbitrum.io/rpc",
  8453: "https://mainnet.base.org",
  4663: "https://rpc.mainnet.chain.robinhood.com",
  46630: "https://rpc.testnet.chain.robinhood.com",
};

export async function chainFor(source: SourceChain) {
  const { arbitrum, base, mainnet } = await import("viem/chains");
  if (source.chainId === 4663 || source.chainId === 46630) {
    const { robinhoodChain } = await import("./arcus/config");
    return robinhoodChain(source.chainId === 4663 ? "mainnet" : "testnet");
  }
  return source.chainId === base.id ? base : source.chainId === mainnet.id ? mainnet : arbitrum;
}

export async function readUsdcBalance(source: SourceChain, owner: `0x${string}`) {
  const { createPublicClient, erc20Abi, http } = await import("viem");
  const client = createPublicClient({ chain: await chainFor(source), transport: http(RPC_URLS[source.chainId]) });
  return client.readContract({ address: source.usdc, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

/**
 * A Lighter instance's intent address for this wallet and chain: stablecoin sent there is credited to the wallet's
 * account on that instance (core: USDC via CCTP from Arbitrum/Base; Robinhood: USDG on Robinhood Chain).
 */
export async function lighterIntentAddress(config: LighterConfig, source: SourceChain, owner: `0x${string}`) {
  const response = await fetch(`${config.apiUrl}/api/v1/createIntentAddress`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ chain_id: String(source.chainId), from_addr: owner, amount: "0", is_external_deposit: "true" }),
  });
  const body = (await response.json().catch(() => ({}))) as { intent_address?: string; message?: string };
  if (!response.ok || !body.intent_address || !/^0x[0-9a-fA-F]{40}$/.test(body.intent_address)) {
    throw new VenueError(body.message ?? `${config.name} didn't return a deposit address.`);
  }
  return body.intent_address as `0x${string}`;
}

/** A wallet client on the source chain, switching the wallet to it (adding the chain when it doesn't know it). */
export async function walletOn(provider: EIP1193Provider, account: `0x${string}`, source: SourceChain) {
  const { createWalletClient, custom } = await import("viem");
  const chain = await chainFor(source);
  const wallet = createWalletClient({ account, chain, transport: custom(provider) });
  if ((await wallet.getChainId()) !== chain.id) {
    try {
      await wallet.switchChain({ id: chain.id });
    } catch {
      await wallet.addChain({ chain });
    }
  }
  return { wallet, chain };
}

/** A read-only client for a source chain. */
export async function publicClientOn(source: SourceChain) {
  const { createPublicClient, http } = await import("viem");
  return createPublicClient({ chain: await chainFor(source), transport: http(RPC_URLS[source.chainId]) });
}

/**
 * Deposits USDC into the wallet's Aster futures account: an exact approval of Aster's vault on that chain, then
 * `depositFor(usdc, wallet, amount, 0)` (broker 0 = futures account).
 */
export async function depositToAster(provider: EIP1193Provider, account: `0x${string}`, source: SourceChain, units: bigint) {
  const { ASTER_VAULTS } = await import("./deposits");
  const vault = ASTER_VAULTS[source.chainId];
  if (!vault) throw new VenueError(`Aster doesn't take deposits from ${source.name} here.`);
  const { createPublicClient, erc20Abi, http } = await import("viem");
  const { wallet, chain } = await walletOn(provider, account, source);
  const client = createPublicClient({ chain, transport: http(RPC_URLS[source.chainId]) });
  const allowance = await client.readContract({ address: source.usdc, abi: erc20Abi, functionName: "allowance", args: [account, vault] });
  if (allowance < units) {
    const approval = await wallet.writeContract({ address: source.usdc, abi: erc20Abi, functionName: "approve", args: [vault, units] });
    if ((await client.waitForTransactionReceipt({ hash: approval })).status !== "success") throw new VenueError(`The ${source.symbol} approval reverted.`);
  }
  const vaultAbi = [
    {
      type: "function",
      name: "depositFor",
      stateMutability: "payable",
      inputs: [
        { name: "currency", type: "address" },
        { name: "forAddress", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "broker", type: "uint256" },
      ],
      outputs: [],
    },
  ] as const;
  const hash = await wallet.writeContract({ address: vault, abi: vaultAbi, functionName: "depositFor", args: [source.usdc, account, units, 0n] });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new VenueError("The Aster deposit reverted.");
  return { hash, explorerUrl: `${source.explorer}/tx/${hash}` };
}

/** Sends USDC on the source chain (switching the wallet to it first) and waits for the receipt. */
export async function sendUsdc(provider: EIP1193Provider, account: `0x${string}`, source: SourceChain, to: `0x${string}`, units: bigint) {
  const { createPublicClient, erc20Abi, http } = await import("viem");
  const { wallet, chain } = await walletOn(provider, account, source);
  const hash = await wallet.writeContract({ address: source.usdc, abi: erc20Abi, functionName: "transfer", args: [to, units] });
  const receipt = await createPublicClient({ chain, transport: http(RPC_URLS[source.chainId]) }).waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new VenueError(`The ${source.symbol} transfer reverted.`);
  return { hash, explorerUrl: `${source.explorer}/tx/${hash}` };
}

/** Orderly's vault takes `VaultDepositFE { accountId, brokerHash, tokenHash, tokenAmount }`; its fee is paid in ETH. */
const ORDERLY_DEPOSIT = [
  { name: "accountId", type: "bytes32" },
  { name: "brokerHash", type: "bytes32" },
  { name: "tokenHash", type: "bytes32" },
  { name: "tokenAmount", type: "uint128" },
] as const;
const ORDERLY_VAULT_ABI = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [{ name: "data", type: "tuple", components: ORDERLY_DEPOSIT }], outputs: [] },
  {
    type: "function",
    name: "getDepositFee",
    stateMutability: "view",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "data", type: "tuple", components: ORDERLY_DEPOSIT },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Deposits USDC into the wallet's Orderly account (registered under our broker): an exact approval of Orderly's vault,
 * then `deposit` with the vault's cross-chain fee (`getDepositFee`, in ETH) as the value. Credited in a few minutes.
 */
export async function depositToOrderly(provider: EIP1193Provider, account: `0x${string}`, source: SourceChain, units: bigint) {
  const [{ orderlyConfig, ORDERLY_VAULTS }, { orderlyAccountId, orderlyHash }, { orderlyRegistered }] = await Promise.all([
    import("./orderly/config"),
    import("./orderly/sign"),
    import("./orderly/onboarding"),
  ]);
  const brokerId = orderlyConfig.brokerId;
  if (!brokerId) throw new VenueError("Orderly isn't set up on this site yet.");
  if (!(await orderlyRegistered(account))) throw new VenueError("Set up Orderly first (register the account), then deposit.");
  const vault = Object.values(ORDERLY_VAULTS).find((entry) => entry.chainId === source.chainId)?.vault ?? (source.chainId === 8453 || source.chainId === 1 ? ORDERLY_VAULTS.mainnet.vault : null);
  if (!vault) throw new VenueError(`Orderly doesn't take deposits from ${source.name} here.`);
  const { createPublicClient, erc20Abi, http } = await import("viem");
  const { wallet, chain } = await walletOn(provider, account, source);
  const client = createPublicClient({ chain, transport: http(RPC_URLS[source.chainId]) });
  const allowance = await client.readContract({ address: source.usdc, abi: erc20Abi, functionName: "allowance", args: [account, vault] });
  if (allowance < units) {
    const approval = await wallet.writeContract({ address: source.usdc, abi: erc20Abi, functionName: "approve", args: [vault, units] });
    if ((await client.waitForTransactionReceipt({ hash: approval })).status !== "success") throw new VenueError(`The ${source.symbol} approval reverted.`);
  }
  const data = { accountId: orderlyAccountId(account, brokerId), brokerHash: orderlyHash(brokerId), tokenHash: orderlyHash("USDC"), tokenAmount: units };
  const fee = await client.readContract({ address: vault, abi: ORDERLY_VAULT_ABI, functionName: "getDepositFee", args: [account, data] });
  const hash = await wallet.writeContract({ address: vault, abi: ORDERLY_VAULT_ABI, functionName: "deposit", args: [data], value: fee });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new VenueError("The Orderly deposit reverted.");
  return { hash, explorerUrl: `${source.explorer}/tx/${hash}` };
}
