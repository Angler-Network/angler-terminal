/**
 * GeckoTerminal / CoinGecko on-chain `networks/{net}/tokens/multi/{addresses}` (up to 30 per call): price, 24h volume,
 * pool liquidity (total reserve) and market cap per token. The fallback for EVM tokens DexScreener leaves bare; calls
 * are scarce (free ~10/min site-wide, shared with the pool charts), so the server asks only for what's missing. Pure,
 * unit-tested.
 */
import type { TokenMarket } from "./listings";

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
