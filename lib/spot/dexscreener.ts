/**
 * DexScreener's free API (api.dexscreener.com, no key, ~300 requests a minute): live prices, volume and liquidity for
 * EVM tokens, and a search across chains. Pure parsing, unit-tested; the server calls it from `server.ts`.
 */
import { evmSwapChainByDexscreener } from "@/lib/venues/uniswap/chains";
import { uniswapListingId, type SpotListing, type TokenMarket } from "./listings";

export interface DexPair {
  chainId?: string;
  dexId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  info?: { imageUrl?: string };
}

/** DexScreener's `tokens/v1` takes up to 30 addresses per call. */
export const DEXSCREENER_BATCH = 30;

const finite = (value: unknown) => {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
};

/**
 * Market numbers per token address (lowercase) from pairs where the token is the base: price, change and market cap
 * from its deepest pair, volume and liquidity summed over all of them.
 */
export function readDexMarkets(pairs: unknown): Map<string, TokenMarket> {
  const markets = new Map<string, TokenMarket & { depth: number }>();
  for (const pair of Array.isArray(pairs) ? (pairs as DexPair[]) : []) {
    const address = pair?.baseToken?.address?.toLowerCase();
    if (!address) continue;
    const depth = finite(pair.liquidity?.usd) ?? 0;
    const current = markets.get(address);
    const volume = (current?.volume24h ?? 0) + (finite(pair.volume?.h24) ?? 0);
    const liquidity = (current?.liquidity ?? 0) + depth;
    const deeper = !current || depth > current.depth;
    markets.set(address, {
      ...(deeper
        ? { price: finite(pair.priceUsd), change24h: finite(pair.priceChange?.h24), marketCap: finite(pair.marketCap) ?? finite(pair.fdv), depth }
        : current),
      icon: current?.icon ?? pair.info?.imageUrl,
      volume24h: volume,
      liquidity,
    });
  }
  return new Map([...markets].map(([address, { depth: _depth, ...market }]) => [address, market]));
}

/**
 * Search results as unverified Uniswap listings: tokens on the swap chains that have at least one Uniswap pool (the
 * Trading API only routes through Uniswap pools and UniswapX fillers). Decimals are read on chain once picked.
 */
export function readDexSearch(body: unknown): SpotListing[] {
  const pairs = ((body as { pairs?: unknown } | null)?.pairs ?? []) as DexPair[];
  if (!Array.isArray(pairs)) return [];
  const byToken = new Map<string, { chainId: number; pairs: DexPair[]; uniswap: boolean }>();
  for (const pair of pairs) {
    const chain = pair?.chainId ? evmSwapChainByDexscreener(pair.chainId) : null;
    const address = pair?.baseToken?.address;
    if (!chain || !address || !/^0x[0-9a-fA-F]{40}$/.test(address)) continue;
    const key = uniswapListingId(chain.id, address);
    const entry = byToken.get(key) ?? { chainId: chain.id, pairs: [], uniswap: false };
    entry.pairs.push(pair);
    entry.uniswap ||= pair.dexId === "uniswap";
    byToken.set(key, entry);
  }
  return [...byToken.entries()].flatMap(([id, entry]) => {
    if (!entry.uniswap) return [];
    const base = entry.pairs[0].baseToken!;
    const market = readDexMarkets(entry.pairs).get(base.address!.toLowerCase()) ?? {};
    if (!base.symbol) return [];
    return [
      {
        id,
        venue: "uniswap" as const,
        address: base.address!,
        chainId: entry.chainId,
        symbol: base.symbol,
        name: base.name || base.symbol,
        icon: market.icon,
        category: "crypto" as const,
        verified: false,
        price: market.price,
        change24h: market.change24h,
        volume24h: market.volume24h,
        liquidity: market.liquidity,
        marketCap: market.marketCap,
      },
    ];
  });
}
