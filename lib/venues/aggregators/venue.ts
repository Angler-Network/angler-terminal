"use client";

/** 0x and Odos swap execution: loaded on demand (viem). */

import { createPublicClient, erc20Abi, http, parseEventLogs, type EIP1193Provider } from "viem";
import { walletMessage, walletOnChain } from "../evm-wallet";
import { VenueError } from "../types";
import { isNativeToken } from "../uniswap/chains";
import { UniswapSwapFailedError, type UniswapSwapInput, type UniswapSwapResult } from "../uniswap/venue";
import { fetchAggregatorQuote } from "./client";
import { AGGREGATOR_NAMES, type AggregatorProvider } from "./types";

const explorerTx = (chain: UniswapSwapInput["chain"], hash: string) => `${chain.blockExplorers?.default.url ?? ""}/tx/${hash}`;

/**
 * Exact-input swap through 0x or Odos: a fresh firm quote for this wallet, an exact ERC-20 approval of the router the
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
