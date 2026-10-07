/**
 * GeckoTerminal / CoinGecko on-chain `networks/{net}/tokens/multi/{addresses}` (up to 30 per call): price, 24h volume,
 * pool liquidity (total reserve) and market cap per token. The fallback for EVM tokens DexScreener leaves bare; calls
 * are scarce (free ~10/min site-wide, shared with the pool charts), so the server asks only for what's missing. Pure,
 * unit-tested.
 */
import type { TokenMarket, UniswapTokenRecord } from "./listings";

export const GECKO_TOKENS_BATCH = 30;

const number = (value: unknown) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
};

/** Market numbers per lowercase token address. */
export function readGeckoTokens(body: unknown): Map<string, TokenMarket> {
  const markets = new Map<string, TokenMarket>();
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return markets;
  for (const entry of data as Array<{ attributes?: Record<string, unknown> }>) {
    const attributes = entry?.attributes ?? {};
    const address = typeof attributes.address === "string" ? attributes.address.toLowerCase() : "";
    if (!address) continue;
    const image = typeof attributes.image_url === "string" && attributes.image_url.startsWith("https://") ? attributes.image_url : undefined;
    const price = number(attributes.price_usd);
    markets.set(address, {
      price: price && price > 0 ? price : undefined,
      volume24h: number((attributes.volume_usd as { h24?: unknown } | undefined)?.h24),
      liquidity: number(attributes.total_reserve_in_usd),
      marketCap: number(attributes.market_cap_usd) ?? number(attributes.fdv_usd),
      icon: image,
    });
  }
  return markets;
}

/**
 * The tokens of a network's busiest pools (`networks/{net}/pools?sort=h24_volume_usd_desc&include=base_token,quote_token`)
 * in the Uniswap token-list shape, busiest first: the top list for chains Uniswap's `/tokens` doesn't rank (Robinhood).
 */
export function readGeckoPoolTokens(body: unknown, chainId: number): UniswapTokenRecord[] {
  const record = (body ?? {}) as { data?: unknown; included?: unknown };
  if (!Array.isArray(record.data) || !Array.isArray(record.included)) return [];
  const tokens = new Map<string, UniswapTokenRecord>();
  for (const entry of record.included as Array<{ id?: unknown; type?: unknown; attributes?: Record<string, unknown> }>) {
    const attributes = entry?.attributes ?? {};
    if (entry?.type !== "token" || typeof entry.id !== "string" || typeof attributes.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(attributes.address)) continue;
    if (typeof attributes.symbol !== "string" || typeof attributes.decimals !== "number") continue;
    const image = typeof attributes.image_url === "string" && attributes.image_url.startsWith("https://") ? attributes.image_url : null;
    tokens.set(entry.id, {
      address: attributes.address,
      chainId,
      symbol: attributes.symbol,
      name: typeof attributes.name === "string" ? attributes.name : attributes.symbol,
      decimals: attributes.decimals,
      logoURI: image,
    });
  }
  const ordered = new Map<string, UniswapTokenRecord>();
  for (const pool of record.data as Array<{ relationships?: Record<string, { data?: { id?: unknown } }> }>) {
    for (const side of ["base_token", "quote_token"]) {
      const id = pool?.relationships?.[side]?.data?.id;
      const token = typeof id === "string" ? tokens.get(id) : undefined;
      if (token) ordered.set(token.address!.toLowerCase(), token);
    }
  }
  return [...ordered.values()];
}
