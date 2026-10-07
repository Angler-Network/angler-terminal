/**
 * Spot pairs from the integrated spot venues' own pools: Jupiter (Solana tokens, including tokenized stocks) and
 * Arcus (stock, index and commodity tokens on Robinhood Chain). Nothing here is a fixed list: which token stands for
 * an asset (BTC → cbBTC or WBTC) is decided by live liquidity every time the list is read. Pure, unit-tested.
 */

export type SpotVenueKey = "jupiter" | "arcus";

export type SpotCategory = "crypto" | "stock" | "index" | "commodity";

export interface SpotListing {
  /** `${venue}:${address}`, unique across venues. */
  id: string;
  venue: SpotVenueKey;
  /** Solana mint or EVM token address. */
  address: string;
  symbol: string;
  name: string;
  icon?: string;
  category: SpotCategory;
  verified: boolean;
  price?: number;
  /** 24h change in percent. */
  change24h?: number;
  volume24h?: number;
  liquidity?: number;
  marketCap?: number;
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
  stats24h?: { priceChange?: number; buyVolume?: number; sellVolume?: number };
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
    volume24h: stats ? volume : undefined,
    liquidity: finite(record.liquidity),
    marketCap: finite(record.mcap),
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
 * The listing to trade `base` with: verified listings that represent it, the most liquid first (listings without a
 * liquidity figure, like Arcus tokens, come after those with one). Null when no venue lists it.
 */
export function pickSpotListing(listings: SpotListing[], base: string, venue?: SpotVenueKey): SpotListing | null {
  const candidates = listings.filter((listing) => listing.verified && (!venue || listing.venue === venue) && representsAsset(listing, base));
  candidates.sort((a, b) => (b.liquidity ?? -1) - (a.liquidity ?? -1));
  return candidates[0] ?? null;
}

/** One entry per id (later sources fill gaps in earlier ones), most traded first. */
export function mergeListings(...sources: SpotListing[][]): SpotListing[] {
  const byId = new Map<string, SpotListing>();
  for (const listing of sources.flat()) {
    const existing = byId.get(listing.id);
    byId.set(listing.id, existing ? { ...listing, ...Object.fromEntries(Object.entries(existing).filter(([, value]) => value !== undefined)) } : listing);
  }
  return [...byId.values()].sort((a, b) => (b.volume24h ?? -1) - (a.volume24h ?? -1));
}
