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
  if (isNativeToken(address)) return { decimals: 18, symbol: "ETH", name: "Ether" };
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
export function useEvmToken(ref: string | undefined): EvmToken | null | undefined {
  const parsed = parseEvmRef(ref);
  const id = parsed ? uniswapListingId(parsed.chain.id, parsed.address) : null;
  const listings = useSpotListings(Boolean(parsed));
  const cached = id ? listings?.find((listing) => listing.id === id) : undefined;
  const [extra, setExtra] = useState<{ id: string; listing: SpotListing | null; meta: Awaited<ReturnType<typeof readTokenMeta>> | null } | null>(null);
  const needsLookup = Boolean(parsed && listings && (!cached || cached.decimals === undefined));

  useEffect(() => {
    if (!needsLookup || !parsed || !id) return;
    let active = true;
    Promise.all([cached ? Promise.resolve(cached) : searchListing(id, parsed.address).catch(() => null), readTokenMeta(parsed.chain, parsed.address).catch(() => null)]).then(
      ([listing, meta]) => active && setExtra({ id, listing, meta }),
    );
    return () => {
      active = false;
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
