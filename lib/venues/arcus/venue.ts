"use client";

/** Swaps and balances: loaded on demand (viem + the Arcus SDK), token lookups live in catalog.ts. */

import {
  MAX_UINT256,
  PermitUnsupportedError,
  buildArcusSellTokenPermitIfNeeded,
  erc20ApproveAbi,
  signQuote,
  type ArcusFirmQuote,
} from "@arcus-xyz/arcus-spot-sdk";
import { createPublicClient, createWalletClient, custom, erc20Abi, http, type EIP1193Provider } from "viem";
import { VenueError, type OrderSide } from "../types";
import { ARCUS_MIN_NOTIONAL_USD, ARCUS_SLIPPAGE_BPS, ROBINHOOD_TESTNET_FAUCET_URL, TEST_USDG_MINT_AMOUNT, arcusConfig, explorerTxUrl } from "./config";
import { arcusQuoteToken, call } from "./catalog";
import { arcusErrorMessage, arcusPriceImpactPct, pickArcusQuote, readReferencePrice } from "./quote";
import type { ArcusToken } from "./tokens";

const STATUS_TIMEOUT_MS = 45_000;

const publicClient = createPublicClient({ chain: arcusConfig.chain, transport: http() });

export async function getArcusBalances(owner: `0x${string}`, tokens: ArcusToken[]) {
  const amounts = await Promise.all(
    tokens.map((token) => publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [owner] })),
  );
  return Object.fromEntries(tokens.map((token, index) => [token.address, amounts[index]])) as Record<string, bigint>;
}

/** Native ETH on Robinhood Chain, only needed for a one-time approve on tokens without permit support. */
export function getArcusNativeBalance(owner: `0x${string}`) {
  return publicClient.getBalance({ address: owner });
}

function walletMessage(error: unknown) {
  const code = (error as { code?: number } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === 4001 || /reject|denied|cancel/i.test(message)) return "You rejected the request in your wallet.";
  return message.split("\n")[0];
}

/** Moves the wallet to Robinhood Chain, adding the network first when the wallet doesn't know it. */
async function walletOnRobinhood(provider: EIP1193Provider, account: `0x${string}`) {
  const wallet = createWalletClient({ account, chain: arcusConfig.chain, transport: custom(provider) });
  if ((await wallet.getChainId()) === arcusConfig.chainId) return wallet;
  try {
    await wallet.switchChain({ id: arcusConfig.chainId });
  } catch (error) {
    const code = (error as { code?: number; cause?: { code?: number } }).code ?? (error as { cause?: { code?: number } }).cause?.code;
    if (code !== 4902 && !/unrecognized|not added|unknown chain/i.test(String((error as Error).message))) throw error;
    await wallet.addChain({ chain: arcusConfig.chain });
    if ((await wallet.getChainId()) !== arcusConfig.chainId) await wallet.switchChain({ id: arcusConfig.chainId });
  }
  return wallet;
}

const mintAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

/**
 * Testnet only: mints test USDG to the wallet through the token's open `mint` (explorers can't call it because the
 * contract isn't verified). Needs a little testnet ETH for gas. Resolves to the explorer link of the transaction.
 */
export async function mintTestUsdg(provider: EIP1193Provider, account: `0x${string}`) {
  if (arcusConfig.network !== "testnet") throw new VenueError("Test USDG exists on testnet only.");
  const token = await arcusQuoteToken();
  const amount = BigInt(TEST_USDG_MINT_AMOUNT) * 10n ** BigInt(token.decimals);
  if ((await publicClient.getBalance({ address: account })) === 0n) {
    throw new VenueError(`Minting needs a little testnet ETH for gas. Get some at ${ROBINHOOD_TESTNET_FAUCET_URL}, then try again.`);
  }
  try {
    await publicClient.simulateContract({ account, address: token.address, abi: mintAbi, functionName: "mint", args: [account, amount] });
  } catch {
    throw new VenueError("The test token refused this mint: the wallet may have hit its mint limit. Try again later.");
  }
  try {
    const wallet = await walletOnRobinhood(provider, account);
    const hash = await wallet.writeContract({ address: token.address, abi: mintAbi, functionName: "mint", args: [account, amount] });
    await publicClient.waitForTransactionReceipt({ hash });
    return explorerTxUrl(hash);
  } catch (error) {
    throw new VenueError(walletMessage(error));
  }
}

async function waitForSwap(txHash: string) {
  const deadline = Date.now() + STATUS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await call<{ status?: string; errorCode?: string; reason?: string }>(
      `status?${new URLSearchParams({ venue: "arcus", id: txHash, chainId: String(arcusConfig.chainId) })}`,
    ).catch(() => null);
    if (status?.status === "confirmed") return;
    if (status?.status === "failed") throw new ArcusSwapFailedError(arcusErrorMessage(status.errorCode, status.reason || "Arcus couldn't settle the swap."), txHash);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new ArcusSwapFailedError("Arcus accepted the swap but hasn't confirmed it yet. Check the explorer.", txHash);
}

export class ArcusSwapFailedError extends VenueError {
  readonly explorerUrl: string;
  constructor(message: string, txHash: string) {
    super(message);
    this.explorerUrl = explorerTxUrl(txHash);
  }
}

export interface ArcusSwapInput {
  provider: EIP1193Provider;
  account: `0x${string}`;
  token: ArcusToken;
  side: OrderSide;
  sizeUsd: number;
  /** Refuse fills worse than this against the router's reference price (percent). */
  maxPriceImpactPct: number;
}

export interface ArcusSwapResult {
  txHash: string;
  explorerUrl: string;
  sold: { amount: bigint; token: ArcusToken };
  bought: { amount: bigint; token: ArcusToken };
}

/**
 * USD-sized market swap between the stablecoin and a stock token: quote, one-time Permit2 allowance, EIP-712
 * signature, gasless submit through the router's relayer, then wait for settlement.
 */
export async function arcusSwap(input: ArcusSwapInput): Promise<ArcusSwapResult> {
  try {
    return await swap(input);
  } catch (error) {
    if (error instanceof VenueError) throw error;
    // viem errors (RPC down, chain unreachable) are long multi-line messages.
    throw new VenueError(`Robinhood Chain is unreachable right now: ${walletMessage(error)}`);
  }
}

async function swap({ provider, account, token, side, sizeUsd, maxPriceImpactPct }: ArcusSwapInput): Promise<ArcusSwapResult> {
  if (sizeUsd < ARCUS_MIN_NOTIONAL_USD) throw new VenueError(`Arcus needs at least $${ARCUS_MIN_NOTIONAL_USD} per trade.`);
  const stable = await arcusQuoteToken();
  const usdAmount = BigInt(Math.floor(sizeUsd * 10 ** stable.decimals));
  let sellAmount = usdAmount;
  if (side === "sell") {
    // Size the sale from what the USD size buys right now.
    const price = await call<{ all?: Array<{ venue: string; buyAmount: string }> }>(
      `price?${new URLSearchParams({ chainId: String(arcusConfig.chainId), sellToken: stable.address, buyToken: token.address, sellAmount: usdAmount.toString() })}`,
    );
    const indicative = price.all?.find((entry) => entry.venue === "arcus");
    if (!indicative) throw new VenueError(arcusErrorMessage("NO_QUOTES", "No Arcus price right now."));
    sellAmount = BigInt(indicative.buyAmount);
  }
  const sellToken = side === "buy" ? stable : token;
  const buyToken = side === "buy" ? token : stable;

  const balance = await publicClient.readContract({ address: sellToken.address, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  if (balance < sellAmount) throw new VenueError(`Not enough ${sellToken.symbol} on Robinhood Chain for this trade.`);

  const response = await call<unknown>(
    `quote?${new URLSearchParams({
      chainId: String(arcusConfig.chainId),
      sellToken: sellToken.address,
      buyToken: buyToken.address,
      sellAmount: sellAmount.toString(),
      taker: account,
      slippageBps: String(ARCUS_SLIPPAGE_BPS),
    })}`,
  );
  const quote = pickArcusQuote<ArcusFirmQuote>(response);
  if (!quote) throw new VenueError(arcusErrorMessage("NO_QUOTES", "No Arcus quote right now."));
  const impact = arcusPriceImpactPct(
    { sellAmount: BigInt(quote.sellAmount), buyAmount: BigInt(quote.buyAmount) },
    { sell: sellToken.decimals, buy: buyToken.decimals },
    readReferencePrice(response),
  );
  if (impact !== null && impact > maxPriceImpactPct) {
    throw new VenueError(`Price impact is ${impact.toFixed(2)}%, above the ${maxPriceImpactPct}% limit. Try a smaller size.`);
  }

  let txHash: string;
  try {
    const wallet = await walletOnRobinhood(provider, account);
    let permit;
    try {
      permit = await buildArcusSellTokenPermitIfNeeded({ quote, publicClient, walletClient: wallet });
    } catch (error) {
      if (!(error instanceof PermitUnsupportedError)) throw error;
      // No EIP-2612 permit on this token: a one-time on-chain approval to Permit2 (needs a little ETH for gas).
      if (error.currentAllowance > 0n) {
        await publicClient.waitForTransactionReceipt({
          hash: await wallet.writeContract({ address: error.token, abi: erc20ApproveAbi, functionName: "approve", args: [error.spender, 0n] }),
        });
      }
      await publicClient.waitForTransactionReceipt({
        hash: await wallet.writeContract({ address: error.token, abi: erc20ApproveAbi, functionName: "approve", args: [error.spender, MAX_UINT256] }),
      });
    }
    const signed = await signQuote(quote, wallet, { permits: permit ? [permit] : undefined });
    ({ txHash } = await call<{ txHash: string }>("submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signed),
    }));
  } catch (error) {
    if (error instanceof VenueError) throw error;
    throw new VenueError(walletMessage(error));
  }

  await waitForSwap(txHash);
  return {
    txHash,
    explorerUrl: explorerTxUrl(txHash),
    sold: { amount: BigInt(quote.sellAmount), token: sellToken },
    bought: { amount: BigInt(quote.buyAmount), token: buyToken },
  };
}
