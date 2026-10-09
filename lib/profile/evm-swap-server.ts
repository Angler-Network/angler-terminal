import "server-only";
import { readArcusServerConfig } from "@/lib/venues/arcus/server";
import { readAggregatorConfig } from "@/lib/venues/aggregators/server";
import { EVM_SWAP_CHAINS, type EvmSwapChain } from "@/lib/venues/uniswap/chains";
import { readUniswapServerConfig } from "@/lib/venues/uniswap/server";
import { readBetaWindow } from "@/lib/ops/beta";
import { inBeta } from "./beta-points";
import { NATIVE, readEvmSwap, type EvmReceipt, type EvmTx, type TokenAmount } from "./evm-swap";
import { pointsShareFor } from "./levels";
import { claimTransaction, creditTarget, creditVolume, releaseTransaction } from "./store";

/**
 * Credits an EVM swap that paid our fee (Uniswap, 0x, KyberSwap, Arcus) to the wallet's profile, once per transaction.
 * Volume is the wallet's side priced in USD; points scale with our fee on that venue (`pointsShareFor`, full at the
 * perp base or above). Arcus counts only with ARCUS_FEE_RECIPIENT: the builder wallet its fee is paid to.
 */

export type EvmSwapProvider = "uniswap" | "zerox" | "kyberswap" | "arcus";
export const EVM_SWAP_PROVIDERS: EvmSwapProvider[] = ["uniswap", "zerox", "kyberswap", "arcus"];

const TIMEOUT_MS = 10_000;
const STABLES = new Set(["USDC", "USDT", "USDT0", "USDG", "DAI", "USDB", "USDM", "USDC.E", "USDBC", "PYUSD", "FDUSD", "USDE"]);

/** Our fee on a provider: where it's paid and its rate in bps, or null when that fee isn't set. */
export function providerFee(provider: EvmSwapProvider, env: Record<string, string | undefined>) {
  if (provider === "uniswap") {
    const fee = readUniswapServerConfig(env).fee;
    return fee ? { recipient: fee.recipient, bps: fee.bips } : null;
  }
  if (provider === "arcus") {
    const bps = readArcusServerConfig(env).builderFeeBps;
    const recipient = env.ARCUS_FEE_RECIPIENT?.trim() ?? "";
    return bps && /^0x[0-9a-fA-F]{40}$/.test(recipient) ? { recipient, bps } : null;
  }
  const fee = readAggregatorConfig(env).fee;
  return fee ? { recipient: fee.recipient, bps: fee.bps } : null;
}

async function rpc<T>(chain: EvmSwapChain, method: string, params: unknown[]): Promise<T | null> {
  const response = await fetch(chain.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${chain.name} RPC answered ${response.status}`);
  return ((await response.json()) as { result?: T | null }).result ?? null;
}

/** The transaction and its receipt; a just-mined swap can take a few seconds to reach the public RPC. */
async function readTransaction(chain: EvmSwapChain, hash: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const [tx, receipt] = await Promise.all([rpc<EvmTx>(chain, "eth_getTransactionByHash", [hash]), rpc<EvmReceipt>(chain, "eth_getTransactionReceipt", [hash])]);
    if (tx && receipt) return { tx, receipt };
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  return null;
}

/** A token amount in USD: the chain's dollars at $1, anything else (the native coin as its wrapped token) by DefiLlama. */
async function usdOf(chain: EvmSwapChain, side: TokenAmount): Promise<number | null> {
  const address = side.token === NATIVE ? chain.wrapped.toLowerCase() : side.token;
  const known = chain.pay.find((token) => token.address.toLowerCase() === address || (side.token === NATIVE && token.address === NATIVE));
  if (known && STABLES.has(known.symbol.toUpperCase())) return Number(side.amount) / 10 ** known.decimals;
  const key = `${chain.llama}:${address}`;
  const response = await fetch(`https://coins.llama.fi/prices/current/${key}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) return null;
  const coin = ((await response.json()) as { coins?: Record<string, { price?: number; decimals?: number }> }).coins?.[key];
  const decimals = side.token === NATIVE ? 18 : coin?.decimals;
  return coin?.price && coin.price > 0 && Number.isInteger(decimals) ? (Number(side.amount) / 10 ** (decimals as number)) * coin.price : null;
}

/**
 * A swap whose own sides have no price (a meme coin for native ETH) priced by its largest leg in a token the chain pays
 * with (its dollars, the wrapped native coin).
 */
async function commonLegUsd(chain: EvmSwapChain, legs: TokenAmount[]) {
  const common = new Set([chain.wrapped.toLowerCase(), ...chain.pay.map((token) => token.address.toLowerCase())]);
  let best = 0;
  for (const leg of legs.filter((entry) => common.has(entry.token)).slice(0, 6)) best = Math.max(best, (await usdOf(chain, leg).catch(() => null)) ?? 0);
  return best > 0 ? best : null;
}

export type EvmSwapClaim = { ok: true; venue: EvmSwapProvider; usd: number; profile: string } | { ok: false; error: string; status: number };

export async function claimEvmSwap(chainId: number, hash: string, provider: EvmSwapProvider, wallet: string): Promise<EvmSwapClaim> {
  const chain = EVM_SWAP_CHAINS.find((entry) => entry.id === chainId);
  if (!chain) return { ok: false, error: "Unknown chain.", status: 400 };
  const fee = providerFee(provider, process.env);
  if (!fee) return { ok: false, error: "No Angler fee on this venue, so no points.", status: 422 };
  const read = await readTransaction(chain, hash);
  if (!read) return { ok: false, error: "Transaction not found.", status: 404 };
  const swap = readEvmSwap(read.tx, read.receipt, wallet, [fee.recipient]);
  if (!swap) return { ok: false, error: "Not a swap placed through Angler.", status: 422 };
  const usd =
    (swap.input ? await usdOf(chain, swap.input).catch(() => null) : null) ??
    (swap.output ? await usdOf(chain, swap.output).catch(() => null) : null) ??
    (await commonLegUsd(chain, swap.legs));
  if (!usd || !(usd > 0)) return { ok: false, error: "Couldn't price the swap.", status: 422 };
  if (!(await claimTransaction(`evm:${chainId}:${hash.toLowerCase()}`))) return { ok: false, error: "Already counted.", status: 409 };
  try {
    const profile = await creditTarget(wallet.toLowerCase());
    const block = read.tx.blockNumber ? await rpc<{ timestamp?: string }>(chain, "eth_getBlockByNumber", [read.tx.blockNumber, false]).catch(() => null) : null;
    const time = block?.timestamp ? Number(BigInt(block.timestamp)) * 1000 : Date.now();
    await creditVolume(profile, provider, usd, (usd * fee.bps) / 10_000, 0, {
      betaUsd: inBeta(await readBetaWindow(), time) ? usd : 0,
      pointsShare: pointsShareFor(fee.bps),
    });
    return { ok: true, venue: provider, usd, profile };
  } catch (error) {
    await releaseTransaction(`evm:${chainId}:${hash.toLowerCase()}`);
    throw error;
  }
}
