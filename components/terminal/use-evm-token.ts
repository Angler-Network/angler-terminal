"use client";

import { useEffect, useState } from "react";
import { uniswapListingId, type SpotListing } from "@/lib/spot/listings";
import { isNativeToken, parseEvmRef, type EvmSwapChain } from "@/lib/venues/uniswap/chains";
import { useSpotListings } from "./use-spot-listings";

/** A Uniswap token on an EVM swap chain, with its market numbers when DexScreener has them. */
export interface EvmToken {
  chain: EvmSwapChain;
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  icon?: string;
  verified: boolean;
  price?: number;
  change24h?: number;
  volume24h?: number;
  liquidity?: number;
  marketCap?: number;
}

const erc20Meta = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

/** Decimals (and names) straight from the token contract, for search hits the Uniswap list doesn't carry. */
async function readTokenMeta(chain: EvmSwapChain, address: `0x${string}`) {
  // The chain's own pay tokens (USDC, ETH, WETH, USDT) are known; no contract call.
  const known = chain.pay.find((entry) => entry.address.toLowerCase() === address.toLowerCase());
  if (known) return { decimals: known.decimals, symbol: known.symbol, name: isNativeToken(address) ? chain.nativeName : known.symbol };
  const { createPublicClient, http } = await import("viem");
  const client = createPublicClient({ transport: http(chain.rpc) });
  const [decimals, symbol, name] = await Promise.all(
    erc20Meta.map((item) => client.readContract({ address, abi: [item], functionName: item.name }).catch(() => undefined)),
  );
  return { decimals: typeof decimals === "number" ? decimals : undefined, symbol: symbol as string | undefined, name: name as string | undefined };
}

async function searchListing(id: string, address: string) {
  const response = await fetch(`/api/spot/search?q=${encodeURIComponent(address)}`);
  const body = response.ok ? ((await response.json()) as { listings?: SpotListing[] }) : {};
  return body.listings?.find((listing) => listing.id === id) ?? null;
}

/**
 * The EVM token an "evm:<chain>:<address>" ref names: the cached Uniswap list first, else a search by address for its
 * market numbers and the contract for its decimals. undefined while loading, null for anything else (a Solana mint,
 * no ref, or a contract that isn't an ERC-20).
 */
/** Waits between failed chain reads of a token before giving up on it. */
const META_RETRY_MS = [1_500, 4_000, 10_000, 20_000];

export function useEvmToken(ref: string | undefined): EvmToken | null | undefined {
  const parsed = parseEvmRef(ref);
  const id = parsed ? uniswapListingId(parsed.chain.id, parsed.address) : null;
  const listings = useSpotListings(Boolean(parsed), { waitForEvm: true });
  const cached = id ? listings?.find((listing) => listing.id === id) : undefined;
  const [extra, setExtra] = useState<{ id: string; listing: SpotListing | null; meta: Awaited<ReturnType<typeof readTokenMeta>> | null } | null>(null);
  const needsLookup = Boolean(parsed && listings && (!cached || cached.decimals === undefined));

  useEffect(() => {
    if (!needsLookup || !parsed || !id) return;
    let active = true;
    let timer: number | undefined;
    // The chain read (decimals, symbol) goes to a public RPC that can fail for a moment: a failed read is tried again
    // (backing off) instead of leaving the swap saying the token doesn't exist.
    const attempt = (count: number) => {
      Promise.all([cached ? Promise.resolve(cached) : searchListing(id, parsed.address).catch(() => null), readTokenMeta(parsed.chain, parsed.address).then(
        (meta) => ({ meta, failed: false }),
        () => ({ meta: null, failed: true }),
      )]).then(([listing, read]) => {
        if (!active) return;
        if (read.failed && count < META_RETRY_MS.length) timer = window.setTimeout(() => attempt(count + 1), META_RETRY_MS[count]);
        else setExtra({ id, listing, meta: read.meta });
      });
    };
    attempt(0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // id covers the chain and address; cached only matters for whether to search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, needsLookup]);

  if (!parsed || !id) return null;
  if (listings === null) return undefined;
  const lookup = extra?.id === id ? extra : null;
  const listing = cached ?? lookup?.listing ?? null;
  const decimals = cached?.decimals ?? lookup?.meta?.decimals;
  if (decimals === undefined) return needsLookup && !lookup ? undefined : null;
  const symbol = listing?.symbol ?? lookup?.meta?.symbol;
  if (!symbol) return null;
  return {
    chain: parsed.chain,
    address: parsed.address,
    symbol,
    name: listing?.name ?? lookup?.meta?.name ?? symbol,
    decimals,
    icon: listing?.icon,
    // The chain's own pay tokens (USDC, ETH, WETH, USDT) are known contracts.
    verified: listing?.verified || parsed.chain.pay.some((entry) => entry.address.toLowerCase() === parsed.address.toLowerCase()),
    price: listing?.price,
    change24h: listing?.change24h,
    volume24h: listing?.volume24h,
    liquidity: listing?.liquidity,
    marketCap: listing?.marketCap,
  };
}
