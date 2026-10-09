"use client";

/** 0x and KyberSwap swap execution: loaded on demand (viem). */

import { createPublicClient, erc20Abi, http, parseEventLogs, parseSignature, type EIP1193Provider } from "viem";
import { walletMessage, walletOnChain } from "../evm-wallet";
import { VenueError } from "../types";
import { isNativeToken } from "../uniswap/chains";
import { UniswapSwapFailedError, type UniswapSwapInput, type UniswapSwapResult } from "../uniswap/venue";
import { fetchAggregatorQuote, fetchGaslessQuote } from "./client";
import { AGGREGATOR_NAMES, type AggregatorProvider, type GaslessSignature, type GaslessStatus, type GaslessTypedData } from "./types";

const explorerTx = (chain: UniswapSwapInput["chain"], hash: string) => `${chain.blockExplorers?.default.url ?? ""}/tx/${hash}`;

/**
 * Exact-input swap through 0x or KyberSwap: a fresh firm quote for this wallet, an exact ERC-20 approval of the router the
 * quote names (when the allowance is short), then the swap transaction. Resolves with what actually arrived.
 */
export async function aggregatorSwap(provider: AggregatorProvider, input: UniswapSwapInput & { provider: EIP1193Provider }): Promise<UniswapSwapResult> {
  try {
    return await swap(provider, input);
  } catch (error) {
    if (error instanceof VenueError) throw error;
    throw new VenueError(walletMessage(error));
  }
}

async function swap(provider: AggregatorProvider, { provider: eip1193, account, chain, tokenIn, tokenOut, amount, slippageBps, maxPriceImpactPct }: UniswapSwapInput): Promise<UniswapSwapResult> {
  const name = AGGREGATOR_NAMES[provider];
  const publicClient = createPublicClient({ chain, transport: http() });
  const native = isNativeToken(tokenIn.address);
  const balance = native
    ? await publicClient.getBalance({ address: account })
    : await publicClient.readContract({ address: tokenIn.address, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  if (balance < amount) throw new VenueError(`Not enough ${tokenIn.symbol} on ${chain.name} for this swap.`);

  const quote = await fetchAggregatorQuote(provider, { chainId: chain.id, tokenIn: tokenIn.address, tokenOut: tokenOut.address, amount, swapper: account, slippageBps, execute: true });
  const tx = quote.aggregator?.tx;
  if (!tx) throw new VenueError(`${name} returned no transaction, so nothing was sent.`);
  if (quote.priceImpactPct !== null && quote.priceImpactPct > maxPriceImpactPct) {
    throw new VenueError(`Price impact is ${quote.priceImpactPct.toFixed(2)}%, above the ${maxPriceImpactPct}% limit. Try a smaller size.`);
  }

  const wallet = await walletOnChain(eip1193, account, chain);
  const spender = quote.aggregator?.allowanceTarget as `0x${string}` | undefined;
  if (!native && spender) {
    const allowance = await publicClient.readContract({ address: tokenIn.address, abi: erc20Abi, functionName: "allowance", args: [account, spender] });
    if (allowance < amount) {
      // Exactly this swap's amount, never an unlimited approval.
      const hash = await wallet.writeContract({ account, chain, address: tokenIn.address, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new UniswapSwapFailedError(`The ${tokenIn.symbol} approval reverted.`, explorerTx(chain, hash));
    }
  }

  const hash = await wallet.sendTransaction({
    account,
    chain,
    to: tx.to as `0x${string}`,
    data: tx.data as `0x${string}`,
    value: BigInt(tx.value || "0"),
    gas: tx.gas ? BigInt(tx.gas) : undefined,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new UniswapSwapFailedError("The swap reverted (often the price moved past the slippage limit). Only gas was spent.", explorerTx(chain, hash));
  }
  const received = isNativeToken(tokenOut.address)
    ? quote.outAmount
    : parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs })
        .filter((log) => log.address.toLowerCase() === tokenOut.address.toLowerCase() && log.args.to.toLowerCase() === account.toLowerCase())
        .reduce((sum, log) => sum + log.args.value, 0n);
  return { txHash: hash, explorerUrl: explorerTx(chain, hash), inAmount: amount, outAmount: received || quote.outAmount, gasless: false };
}

const GASLESS_POLL_MS = 2_500;
const GASLESS_TIMEOUT_MS = 3 * 60_000;
const GASLESS_REASONS: Record<string, string> = {
  order_expired: "the quote expired before it was filled",
  last_look_declined: "the market maker declined it at the last moment",
  transaction_reverted: "the swap reverted (often the price moved past the slippage limit)",
  transaction_simulation_failed: "it failed its simulation",
  insufficient_allowance: "the token's allowance was too low",
  insufficient_balance: "the balance was too low",
};

/**
 * Gasless swap through 0x: a firm quote for this wallet, the wallet signs the gasless approval (when the token needs
 * one and supports it) and the trade, 0x's relayer sends the transaction and takes its gas from the swap. Nothing is
 * sent from the wallet, so it needs no native coin. A token that needs an on-chain approval is refused with a reason.
 */
export async function zeroxGaslessSwap(input: UniswapSwapInput & { provider: EIP1193Provider }): Promise<UniswapSwapResult> {
  try {
    return await gaslessSwap(input);
  } catch (error) {
    if (error instanceof VenueError) throw error;
    throw new VenueError(walletMessage(error));
  }
}

async function gaslessSwap({ provider: eip1193, account, chain, tokenIn, tokenOut, amount, slippageBps, maxPriceImpactPct }: UniswapSwapInput): Promise<UniswapSwapResult> {
  if (isNativeToken(tokenIn.address)) throw new VenueError(`Gasless swaps can't sell ${tokenIn.symbol}, the native coin. Turn Gasless off or sell a token.`);
  const publicClient = createPublicClient({ chain, transport: http() });
  const balance = await publicClient.readContract({ address: tokenIn.address, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  if (balance < amount) throw new VenueError(`Not enough ${tokenIn.symbol} on ${chain.name} for this swap.`);

  const quote = await fetchGaslessQuote({ chainId: chain.id, tokenIn: tokenIn.address, tokenOut: tokenOut.address, amount, swapper: account, slippageBps, execute: true });
  const order = quote.aggregator?.gasless;
  if (!order) throw new VenueError("0x returned no gasless order, so nothing was signed.");
  if (order.approvalNeeded && !order.approval) {
    throw new VenueError(`${tokenIn.symbol} needs a one-time approval that costs gas (it has no gasless permit). Approve it once with Gasless off, then gasless swaps work.`);
  }
  if (quote.priceImpactPct !== null && quote.priceImpactPct > maxPriceImpactPct) {
    throw new VenueError(`Price impact is ${quote.priceImpactPct.toFixed(2)}%, above the ${maxPriceImpactPct}% limit. Try a smaller size.`);
  }

  const wallet = await walletOnChain(eip1193, account, chain);
  const sign = async (data: GaslessTypedData): Promise<GaslessSignature> => {
    // viem derives the domain type itself; the payload's own EIP712Domain entry must not be passed in.
    const types = Object.fromEntries(Object.entries(data.types).filter(([name]) => name !== "EIP712Domain"));
    const signature = await wallet.signTypedData({
      account,
      domain: data.domain as Parameters<typeof wallet.signTypedData>[0]["domain"],
      types,
      primaryType: data.primaryType,
      message: data.message,
    });
    const { r, s, v, yParity } = parseSignature(signature);
    return { signatureType: 2, r, s, v: Number(v ?? BigInt(27 + (yParity ?? 0))) };
  };
  const approval = order.approval ? { ...order.approval, signature: await sign(order.approval.eip712) } : null;
  const trade = { ...order.trade, signature: await sign(order.trade.eip712) };

  const submitted = await fetch("/api/aggregators/gasless/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chainId: chain.id, trade, approval }),
  });
  const submitBody = (await submitted.json().catch(() => ({}))) as { tradeHash?: string; error?: string };
  if (!submitted.ok || !submitBody.tradeHash) throw new VenueError(submitBody.error ?? "0x didn't accept the gasless swap.");

  const started = Date.now();
  while (Date.now() - started < GASLESS_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, GASLESS_POLL_MS));
    const response = await fetch(`/api/aggregators/gasless/status?hash=${submitBody.tradeHash}&chainId=${chain.id}`, { cache: "no-store" }).catch(() => null);
    const status = (await response?.json().catch(() => null)) as GaslessStatus | null;
    if (!status?.status) continue;
    if (status.status === "failed") {
      const why = status.reason ? (GASLESS_REASONS[status.reason] ?? status.reason) : "0x couldn't fill it";
      throw new UniswapSwapFailedError(`The gasless swap failed: ${why}. Nothing was spent.`, status.txHash ? explorerTx(chain, status.txHash) : "");
    }
    if ((status.status === "succeeded" || status.status === "confirmed") && status.txHash) {
      const receipt = await publicClient.getTransactionReceipt({ hash: status.txHash as `0x${string}` }).catch(() => null);
      const received = receipt
        ? parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs })
            .filter((log) => log.address.toLowerCase() === tokenOut.address.toLowerCase() && log.args.to.toLowerCase() === account.toLowerCase())
            .reduce((sum, log) => sum + log.args.value, 0n)
        : 0n;
      return { txHash: status.txHash, explorerUrl: explorerTx(chain, status.txHash), inAmount: amount, outAmount: received || quote.outAmount, gasless: true };
    }
  }
  throw new VenueError("0x accepted the gasless swap but hasn't filled it yet. Check your wallet before trying again.");
}

