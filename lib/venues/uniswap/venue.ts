"use client";

/** Uniswap swap execution: loaded on demand (viem). Quotes and the proxy calls live in client.ts. */

import { createPublicClient, erc20Abi, http, parseEventLogs, type Chain, type EIP1193Provider } from "viem";
import { walletMessage, walletOnChain } from "../evm-wallet";
import { VenueError } from "../types";
import { isNativeToken } from "./chains";
import { callUniswap, fetchUniswapQuote } from "./client";
import { orderOutcome, orderStatusMessage, permitPrimaryType, permitTypes, readUniswapTx, settledAmounts, type UniswapQuote } from "./quote";

const ORDER_TIMEOUT_MS = 120_000;
const ORDER_POLL_MS = 2_000;

export interface UniswapSwapToken {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
}

export interface UniswapSwapInput {
  provider: EIP1193Provider;
  account: `0x${string}`;
  chain: Chain;
  tokenIn: UniswapSwapToken;
  tokenOut: UniswapSwapToken;
  /** Exact input in base units. */
  amount: bigint;
  slippageBps?: number | null;
  /** Refuse classic routes with a larger price impact (percent). */
  maxPriceImpactPct: number;
  /** MEV-protected only (UniswapX); the swap fails rather than going out as a public transaction. */
  privateOnly?: boolean;
}

export interface UniswapSwapResult {
  txHash: string;
  explorerUrl: string;
  inAmount: bigint;
  outAmount: bigint;
  /** UniswapX filled it: the wallet paid no gas. */
  gasless: boolean;
}

export class UniswapSwapFailedError extends VenueError {
  constructor(
    message: string,
    readonly explorerUrl?: string,
  ) {
    super(message);
  }
}

const explorerTx = (chain: Chain, hash: string) => `${chain.blockExplorers?.default.url ?? ""}/tx/${hash}`;

/**
 * Exact-input swap through the Uniswap Trading API: Permit2 allowance (one-time approve transaction when the token
 * lacks it), a fresh quote for this wallet, the Permit2 signature, then either the router transaction (classic
 * routes, the wallet pays gas) or a gasless UniswapX order a filler settles.
 */
export async function uniswapSwap(input: UniswapSwapInput): Promise<UniswapSwapResult> {
  try {
    return await swap(input);
  } catch (error) {
    if (error instanceof VenueError) throw error;
    throw new VenueError(walletMessage(error));
  }
}

async function swap({ provider, account, chain, tokenIn, tokenOut, amount, slippageBps, maxPriceImpactPct, privateOnly = false }: UniswapSwapInput): Promise<UniswapSwapResult> {
  const publicClient = createPublicClient({ chain, transport: http() });
  // Native ETH is sent as the transaction's value: no allowance, and the balance is the account's own.
  const native = isNativeToken(tokenIn.address);
  const balance = native
    ? await publicClient.getBalance({ address: account })
    : await publicClient.readContract({ address: tokenIn.address, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  if (balance < amount) throw new VenueError(`Not enough ${tokenIn.symbol} on ${chain.name} for this swap.`);

  const approval = native
    ? {}
    : await callUniswap<{ approval?: unknown; cancel?: unknown }>("check_approval", {
        walletAddress: account,
        token: tokenIn.address,
        amount: amount.toString(),
        chainId: chain.id,
      });
  const wallet = await walletOnChain(provider, account, chain);
  // Tokens like USDT need the old allowance cleared before a new one; then the one-time Permit2 approval.
  for (const raw of [approval.cancel, approval.approval]) {
    const tx = readUniswapTx(raw);
    if (!tx) continue;
    const hash = await wallet.sendTransaction({ account, chain, to: tx.to, data: tx.data, value: tx.value, gas: tx.gas });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new UniswapSwapFailedError(`The ${tokenIn.symbol} approval reverted.`, explorerTx(chain, hash));
  }

  // Always a fresh quote for this wallet: the card's quotes are price-only and may be stale.
  const quote = await fetchUniswapQuote({ chainId: chain.id, tokenIn: tokenIn.address, tokenOut: tokenOut.address, amount, swapper: account, slippageBps, privateOnly });
  if (quote.priceImpactPct !== null && quote.priceImpactPct > maxPriceImpactPct) {
    throw new VenueError(`Price impact is ${quote.priceImpactPct.toFixed(2)}%, above the ${maxPriceImpactPct}% limit. Try a smaller size.`);
  }
  const signature = quote.permitData ? await signPermit(wallet, account, quote) : undefined;
  return quote.settle === "order"
    ? settleOrder(quote, signature, chain)
    : settleTransaction(quote, signature, { wallet, publicClient, account, chain, tokenOut });
}

async function signPermit(wallet: Awaited<ReturnType<typeof walletOnChain>>, account: `0x${string}`, quote: UniswapQuote) {
  const permit = quote.permitData!;
  const primaryType = permitPrimaryType(permit.types);
  if (!primaryType) throw new VenueError("Uniswap sent a permit this terminal can't read.");
  return wallet.signTypedData({
    account,
    domain: permit.domain as Parameters<typeof wallet.signTypedData>[0]["domain"],
    types: permitTypes(permit.types),
    primaryType,
    message: permit.values,
  });
}

async function settleTransaction(
  quote: UniswapQuote,
  signature: string | undefined,
  context: {
    wallet: Awaited<ReturnType<typeof walletOnChain>>;
    publicClient: ReturnType<typeof createPublicClient>;
    account: `0x${string}`;
    chain: Chain;
    tokenOut: UniswapSwapToken;
  },
): Promise<UniswapSwapResult> {
  const { wallet, publicClient, account, chain, tokenOut } = context;
  // signature and permitData go together or not at all.
  const response = await callUniswap<{ swap?: unknown }>("swap", signature ? { quote: quote.raw, signature, permitData: quote.permitData } : { quote: quote.raw });
  const tx = readUniswapTx(response.swap);
  if (!tx) throw new VenueError("Uniswap returned an empty swap transaction, so nothing was sent.");
  const hash = await wallet.sendTransaction({ account, chain, to: tx.to, data: tx.data, value: tx.value, gas: tx.gas });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new UniswapSwapFailedError("The swap reverted (often the price moved past the slippage limit). Only gas was spent.", explorerTx(chain, hash));
  }
  // What actually arrived: the output token's transfers to the wallet in this transaction.
  const received = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs })
    .filter((log) => log.address.toLowerCase() === tokenOut.address.toLowerCase() && log.args.to.toLowerCase() === account.toLowerCase())
    .reduce((sum, log) => sum + log.args.value, 0n);
  return { txHash: hash, explorerUrl: explorerTx(chain, hash), inAmount: quote.inAmount, outAmount: received || quote.outAmount, gasless: false };
}

async function settleOrder(quote: UniswapQuote, signature: string | undefined, chain: Chain): Promise<UniswapSwapResult> {
  if (!signature) throw new VenueError("Uniswap's order needs a signature but sent nothing to sign.");
  const { orderId } = await callUniswap<{ orderId?: string }>("order", { signature, quote: quote.raw, routing: quote.routing });
  if (!orderId) throw new VenueError("Uniswap didn't accept the order.");
  const deadline = Date.now() + ORDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, ORDER_POLL_MS));
    const { orders } = await callUniswap<{ orders?: Array<Record<string, unknown>> }>(`orders?${new URLSearchParams({ orderId })}`).catch(() => ({ orders: undefined }));
    const order = orders?.[0];
    const outcome = orderOutcome(order?.orderStatus);
    if (outcome === "pending") continue;
    if (outcome === "failed") throw new UniswapSwapFailedError(orderStatusMessage(order?.orderStatus));
    const txHash = typeof order?.txHash === "string" ? order.txHash : orderId;
    const settled = settledAmounts(order);
    return {
      txHash,
      explorerUrl: explorerTx(chain, txHash),
      inAmount: settled?.amountIn || quote.inAmount,
      outAmount: settled?.amountOut ?? quote.outAmount,
      gasless: true,
    };
  }
  throw new UniswapSwapFailedError("The order is still open. It fills or expires on its own; check your wallet in a minute.");
}
