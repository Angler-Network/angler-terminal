/**
 * Spot pairs from the integrated spot venues' own pools: Jupiter (Solana tokens, including tokenized stocks) and
 * Arcus (stock, index and commodity tokens on Robinhood Chain). Nothing here is a fixed list: which token stands for
 * an asset (BTC → cbBTC or WBTC) is decided by live trading volume every time the list is read. Pure, unit-tested.
 */

import { ASSET_SYMBOL } from "../markets/model";

/**
 * The listings a first screen needs (`app/api/spot/listings?part=core`: Jupiter, Arcus, order-book spot), preloaded by
 * /swap and /spot and read by `useSpotListings`. The EVM tokens (Uniswap and pool lists across every chain, about 90%
 * of the bytes) come from `SPOT_EVM_LISTINGS_PATH` after it, so they never hold up the first render.
 */
export const SPOT_LISTINGS_PATH = "/api/spot/listings?part=core";
export const SPOT_EVM_LISTINGS_PATH = "/api/spot/listings?part=evm";

/** Which part of the list a listing belongs to (`?part=`): the EVM tokens are the `uniswap` venue's rows. */
export const listingPart = (listing: { venue: string }) => (listing.venue === "uniswap" ? "evm" : "core");

/** Pool and router venues, plus the order-book spot markets of Hyperliquid and Lighter (`book-spot.ts`). */
export type SpotVenueKey = "jupiter" | "arcus" | "uniswap" | "hyperliquid" | "lighter";

export type SpotCategory = "crypto" | "stock" | "index" | "commodity";

export interface SpotListing {
  /** `${venue}:${address}` (book spot markets: `${venue}:${id}`), unique across venues. */
  id: string;
  venue: SpotVenueKey;
  /** Solana mint, EVM token address, or a book spot ref (`book:hyperliquid:107`) for Hyperliquid and Lighter. */
  address: string;
  /** EVM chain of a Uniswap token (Ethereum, Base, Arbitrum). */
  chainId?: number;
  /** Known for Uniswap list tokens; search results read it on chain when picked. */
  decimals?: number;
  symbol: string;
  name: string;
  /** The terminal asset it trades as, when the venue says so (Hyperliquid "UBTC" → "BTC"); else read from the symbol. */
  asset?: string;
  icon?: string;
  category: SpotCategory;
  verified: boolean;
  price?: number;
  /** 24h change in percent. */
  change24h?: number;
  /** 1h and 6h change in percent (Jupiter, DexScreener; no source offers 4h). */
  change1h?: number;
  change6h?: number;
  volume24h?: number;
  liquidity?: number;
  marketCap?: number;
  /** A dollar token (stablecoin, or a yield-bearing dollar like jlUSDC): listed, but after the rest. */
  stable?: boolean;
  /** A Pons launch on Robinhood Chain: still on its bonding curve, or graduated to its Uniswap v4 pool. */
  pons?: "curve" | "graduated";
  /** The launchpad a Solana token started on, as Jupiter names it ("pump.fun", "letsbonk.fun", "met-dbc"…). */
  launchpad?: string;
  /** A launchpad token's stage: still on its bonding curve, or graduated to a pool (Jupiter's `graduatedPool`). */
  launchStage?: "curve" | "graduated";
}

/** The parts of a Jupiter Tokens V2 record the listings read. */
export interface JupListingRecord {
  id: string;
  name?: string;
  symbol?: string;
  icon?: string;
  usdPrice?: number;
  liquidity?: number;
  mcap?: number;
  isVerified?: boolean;
  tags?: string[];
  launchpad?: string;
  graduatedPool?: string;
  stats24h?: { priceChange?: number; buyVolume?: number; sellVolume?: number };
  stats1h?: { priceChange?: number };
  stats6h?: { priceChange?: number };
}

/** Jupiter tags stablecoins "stable" and yield-bearing tokens "yb"; a yield-bearing token named after USD is a dollar too. */
function isDollarToken(record: JupListingRecord) {
  if (record.tags?.includes("stable")) return true;
  return Boolean(record.tags?.includes("yb")) && /usd/i.test(`${record.symbol ?? ""} ${record.name ?? ""}`);
}

const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** Jupiter tags tokenized stocks ("stocks"); everything else on Solana is crypto. */
export function fromJupRecord(record: JupListingRecord): SpotListing | null {
  if (typeof record.id !== "string" || !record.id || typeof record.symbol !== "string" || !record.symbol) return null;
  const stats = record.stats24h;
  const volume = (finite(stats?.buyVolume) ?? 0) + (finite(stats?.sellVolume) ?? 0);
  return {
    id: `jupiter:${record.id}`,
    venue: "jupiter",
    address: record.id,
    symbol: record.symbol,
    name: record.name || record.symbol,
    icon: typeof record.icon === "string" ? record.icon : undefined,
    category: record.tags?.includes("stocks") ? "stock" : "crypto",
    verified: record.isVerified === true || Boolean(record.tags?.includes("verified")),
    price: finite(record.usdPrice),
    change24h: finite(stats?.priceChange),
    change1h: finite(record.stats1h?.priceChange),
    change6h: finite(record.stats6h?.priceChange),
    volume24h: stats ? volume : undefined,
    liquidity: finite(record.liquidity),
    marketCap: finite(record.mcap),
    ...(isDollarToken(record) && { stable: true }),
    ...(typeof record.launchpad === "string" &&
      /^[\w.-]{1,40}$/.test(record.launchpad) && { launchpad: record.launchpad, launchStage: record.graduatedPool ? "graduated" : "curve" }),
  };
}

/** Arcus token plus an indicative quote (the same asset's perp price, when a perp venue lists it). */
export function fromArcusToken(
  token: { address: string; symbol: string; name: string; category: string },
  quote?: { price: number; changePct: number },
): SpotListing | null {
  const category = token.category === "stock" || token.category === "index" || token.category === "commodity" ? token.category : null;
  if (!category) return null;
  return {
    id: `arcus:${token.address}`,
    venue: "arcus",
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    category,
    verified: true,
    price: quote?.price,
    change24h: quote?.changePct,
  };
}

/** Symbols compare without a leading "$" (the verified dogwifhat token is "$WIF") and without case. */
export function normalizeSpotSymbol(symbol: string) {
  return symbol.trim().replace(/^\$/, "").toUpperCase();
}

const WRAPPER_PREFIXES = ["W", "CB", "Z", "T", "SO", "WH"];

/** Derivatives that track an asset but aren't it (Lombard Staked BTC, Hylo Leveraged BTC). */
const DERIVATIVE_NAME = /\b(leveraged|staked|restaked|yield|short|bear|bull|[0-9]+x)\b/;

/**
 * Whether a listing stands for `base`: the same symbol, a wrapped version (WBTC, cbBTC, …) whose name says it's
 * wrapped or bridged or names the asset, or a tokenized stock ("NVDAx"). The name check keeps unrelated tickers out
 * (TON is not a wrapped ON), and staked or leveraged versions never stand for the asset itself.
 */
export function representsAsset(listing: Pick<SpotListing, "symbol" | "name" | "category">, base: string) {
  const symbol = normalizeSpotSymbol(listing.symbol);
  const wanted = normalizeSpotSymbol(base);
  if (!wanted) return false;
  if (symbol === wanted) return true;
  if (listing.category === "stock" && symbol === `${wanted}X`) return true;
  const prefix = symbol.endsWith(wanted) ? symbol.slice(0, -wanted.length) : null;
  if (prefix === null || !WRAPPER_PREFIXES.includes(prefix)) return false;
  const name = listing.name.toLowerCase();
  if (DERIVATIVE_NAME.test(name)) return false;
  return /\b(wrapped|bridged)\b/.test(name) || new RegExp(`\\b${wanted.toLowerCase()}\\b`).test(name);
}

/**
 * The terminal asset a spot token trades as (WBTC → BTC, NVDAx → NVDA, WIF → WIF), so picking it moves the chart,
 * news and order panel to that asset. Null when its ticker can't be a terminal symbol.
 */
export function assetSymbolOf(listing: Pick<SpotListing, "symbol" | "name" | "category" | "asset">): string | null {
  if (listing.asset) return ASSET_SYMBOL.test(listing.asset) ? listing.asset : null;
  const symbol = normalizeSpotSymbol(listing.symbol);
  if (listing.category === "stock" && symbol.endsWith("X") && representsAsset(listing, symbol.slice(0, -1))) return symbol.slice(0, -1);
  for (const prefix of WRAPPER_PREFIXES) {
    const base = symbol.slice(prefix.length);
    if (symbol.startsWith(prefix) && base.length >= 2 && representsAsset(listing, base)) return base;
  }
  return ASSET_SYMBOL.test(symbol) ? symbol : null;
}

/**
 * The listing to trade `base` with: verified listings that represent it, the most traded first (24h volume: where the
 * market actually is; WBTC holds more pool liquidity, cbBTC trades several times more), pool liquidity breaking ties
 * and ranking tokens without a volume figure. Listings with neither (Arcus tokens) come last. Null when none lists it.
 */
export function pickSpotListing(listings: SpotListing[], base: string, venue?: SpotVenueKey): SpotListing | null {
  const candidates = listings.filter((listing) => listing.verified && (!venue || listing.venue === venue) && representsAsset(listing, base));
  candidates.sort((a, b) => (b.volume24h ?? -1) - (a.volume24h ?? -1) || (b.liquidity ?? -1) - (a.liquidity ?? -1));
  return candidates[0] ?? null;
}

/** Dollar tokens after the rest, then by `metric` (highest first). */
export function byMarketThenStable<T extends { stable?: boolean }>(metric: (entry: T) => number) {
  return (a: T, b: T) => Number(Boolean(a.stable)) - Number(Boolean(b.stable)) || metric(b) - metric(a);
}

/** One entry per id (later sources fill gaps in earlier ones), most traded first, dollar tokens last. */
export function mergeListings(...sources: SpotListing[][]): SpotListing[] {
  const byId = new Map<string, SpotListing>();
  for (const listing of sources.flat()) {
    const existing = byId.get(listing.id);
    byId.set(listing.id, existing ? { ...listing, ...Object.fromEntries(Object.entries(existing).filter(([, value]) => value !== undefined)) } : listing);
  }
  return [...byId.values()].sort(byMarketThenStable((listing) => listing.volume24h ?? -1));
}

/** A token from the Uniswap Trading API's `/tokens` list (token-list shape). */
export interface UniswapTokenRecord {
  name?: string;
  address?: string;
  chainId?: number;
  symbol?: string;
  decimals?: number;
  logoURI?: string | null;
  extensions?: { safetyInfo?: { safetyLevel?: string; buyFee?: number; sellFee?: number } };
  /** Set for Pons launches (`getPonsTokens`). */
  pons?: "curve" | "graduated";
}

/** Live market numbers for a token (DexScreener). */
export interface TokenMarket {
  price?: number;
  change24h?: number;
  change1h?: number;
  change6h?: number;
  volume24h?: number;
  liquidity?: number;
  marketCap?: number;
  icon?: string;
  /** DefiLlama's confidence in the price (0-1); stands in for liquidity when DexScreener has no numbers. */
  confidence?: number;
}

/** Pool liquidity that makes a Uniswap-listed token count as verified when it isn't on Uniswap's default list. */
export const UNISWAP_VERIFIED_LIQUIDITY_USD = 250_000;
/** DefiLlama price confidence that does the same when no liquidity figure is known. */
export const UNISWAP_VERIFIED_CONFIDENCE = 0.95;

const DOLLAR_SYMBOL = /^(USDC|USDT|USDT0|USD₮0|DAI|USDS|USDE|SUSDE|PYUSD|FDUSD|USDG|GHO|LUSD|CRVUSD|USDBC|FRAX|RLUSD|USD0|USDX|EURC)$/i;

export function uniswapListingId(chainId: number, address: string) {
  return `uniswap:${chainId}:${address.toLowerCase()}`;
}

/**
 * A Uniswap-listed EVM token with its market numbers. Tokens Uniswap's compliance check blocks are dropped; tokens
 * with a transfer tax are listed unverified; native ETH and the rest count as verified when they are on Uniswap's
 * default token list or their pools hold real liquidity (top-volume lists can carry wash-traded tokens).
 */
export function fromUniswapToken(record: UniswapTokenRecord, market: TokenMarket = {}): SpotListing | null {
  const { address, chainId, symbol, decimals } = record;
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address) || typeof chainId !== "number") return null;
  if (typeof symbol !== "string" || !symbol || typeof decimals !== "number") return null;
  // Native ETH (the zero address): the chain's own coin, always genuine.
  const native = /^0x0{40}$/.test(address);
  const safety = record.extensions?.safetyInfo;
  if (safety?.safetyLevel === "blocked") return null;
  const taxed = (safety?.buyFee ?? 0) > 0 || (safety?.sellFee ?? 0) > 0;
  // Liquidity decides when DexScreener reported it; else DefiLlama's confidence in the price does.
  const liquid = market.liquidity !== undefined ? market.liquidity >= UNISWAP_VERIFIED_LIQUIDITY_USD : (market.confidence ?? 0) >= UNISWAP_VERIFIED_CONFIDENCE;
  const verified = native || (!taxed && (safety?.safetyLevel === "verified" || liquid));
  return {
    id: uniswapListingId(chainId, address),
    venue: "uniswap",
    address,
    chainId,
    decimals,
    symbol,
    name: record.name || symbol,
    icon: (typeof record.logoURI === "string" && record.logoURI) || market.icon,
    category: "crypto",
    verified,
    ...(record.pons ? { pons: record.pons } : {}),
    price: market.price,
    change24h: market.change24h,
    change1h: market.change1h,
    change6h: market.change6h,
    volume24h: market.volume24h,
    liquidity: market.liquidity,
    marketCap: market.marketCap,
    ...(DOLLAR_SYMBOL.test(symbol) && { stable: true }),
  };
}
