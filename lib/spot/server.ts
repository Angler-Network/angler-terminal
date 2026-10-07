import "server-only";
import { unstable_cache } from "next/cache";
import { venueAvailable } from "@/lib/deployment";
import { pickQuote } from "@/lib/markets/model";
import { getMarkets } from "@/lib/markets/server";
import { arcusFetch } from "@/lib/venues/arcus/server";
import { jupFetch, jupServerConfig } from "@/lib/venues/jupiter/server";
import { uniswapOnRobinhood } from "@/lib/venues/robinhood-sources";
import { EVM_SWAP_CHAINS } from "@/lib/venues/uniswap/chains";
import { readUniswapServerConfig, uniswapFetch } from "@/lib/venues/uniswap/server";
import { DEXSCREENER_BATCH, readDexMarkets, readDexSearch } from "./dexscreener";
import {
  fromArcusToken,
  fromJupRecord,
  fromUniswapToken,
  mergeListings,
  type JupListingRecord,
  type SpotListing,
  type TokenMarket,
  type UniswapTokenRecord,
} from "./listings";

const REVALIDATE_SECONDS = 120;
const TOP_LIMIT = 100;
/** Most traded Uniswap tokens listed per EVM chain. */
const UNISWAP_TOP_LIMIT = 60;
const DEXSCREENER_URL = "https://api.dexscreener.com";
const DEXSCREENER_TIMEOUT_MS = 10_000;

async function jupList(path: string): Promise<SpotListing[]> {
  const response = await jupFetch(path);
  if (!response.ok) throw new Error(`Jupiter ${path} responded ${response.status}`);
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? (body as JupListingRecord[]).flatMap((record) => fromJupRecord(record) ?? []) : [];
}

/** Jupiter's own lists: the most traded and most organically traded tokens of the day, plus tokenized stocks. */
async function jupiterListings(): Promise<SpotListing[]> {
  if (!venueAvailable("jupiter") || !jupServerConfig().apiKey) return [];
  const lists = await Promise.allSettled([
    jupList(`/tokens/v2/toptraded/24h?limit=${TOP_LIMIT}`),
    jupList(`/tokens/v2/toporganicscore/24h?limit=${TOP_LIMIT}`),
    jupList("/tokens/v2/tag?query=stocks"),
  ]);
  for (const list of lists) if (list.status === "rejected") console.error("[spot] jupiter list failed:", list.reason);
  return mergeListings(...lists.map((list) => (list.status === "fulfilled" ? list.value : [])));
}

/** Arcus stock, index and commodity tokens, priced from the same asset's perp quote when a perp venue lists it. */
async function arcusListings(): Promise<SpotListing[]> {
  // The Arcus catalog lists Robinhood Chain stock tokens for Arcus and for Uniswap alike.
  if (!venueAvailable("arcus") && !uniswapOnRobinhood()) return [];
  const [tokensResponse, markets] = await Promise.all([arcusFetch("/v1/tokens", { next: { revalidate: 300 } }), getMarkets("perp").catch(() => [])]);
  if (!tokensResponse.ok) throw new Error(`Arcus tokens responded ${tokensResponse.status}`);
  const body = (await tokensResponse.json()) as unknown;
  const bySymbol = new Map(markets.map((market) => [market.symbol, market]));
  if (!Array.isArray(body)) return [];
  return body.flatMap((entry) => {
    const record = entry as Record<string, unknown>;
    if (record.verified === false || typeof record.address !== "string" || typeof record.symbol !== "string") return [];
    const market = bySymbol.get(record.symbol.toUpperCase());
    const quote = market ? pickQuote(market, "hyperliquid")?.quote : undefined;
    const listing = fromArcusToken(
      { address: record.address, symbol: record.symbol, name: typeof record.name === "string" ? record.name : record.symbol, category: String(record.category ?? "") },
      quote,
    );
    return listing ? [listing] : [];
  });
}

const uniswapOn = () => venueAvailable("uniswap") && Boolean(readUniswapServerConfig(process.env).apiKey);

async function dexscreener(path: string): Promise<unknown> {
  const response = await fetch(`${DEXSCREENER_URL}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(DEXSCREENER_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`DexScreener ${path} responded ${response.status}`);
  return response.json();
}

/** DexScreener numbers for a chain's tokens, 30 addresses per call; a failed batch only leaves those tokens bare. */
async function dexMarkets(chain: string, addresses: string[]) {
  const markets = new Map<string, TokenMarket>();
  const batches = [];
  for (let index = 0; index < addresses.length; index += DEXSCREENER_BATCH) batches.push(addresses.slice(index, index + DEXSCREENER_BATCH));
  const results = await Promise.allSettled(batches.map((batch) => dexscreener(`/tokens/v1/${chain}/${batch.join(",")}`)));
  for (const result of results) {
    if (result.status === "fulfilled") for (const [address, market] of readDexMarkets(result.value)) markets.set(address, market);
    else console.error("[spot] dexscreener prices failed:", result.reason);
  }
  return markets;
}

/** Uniswap's most traded tokens on each EVM swap chain (Trading API `/tokens`), priced from DexScreener. */
async function uniswapListings(): Promise<SpotListing[]> {
  const { apiKey } = readUniswapServerConfig(process.env);
  if (!venueAvailable("uniswap") || !apiKey) return [];
  const lists = await Promise.allSettled(
    EVM_SWAP_CHAINS.map(async (chain) => {
      const response = await uniswapFetch(`/tokens?${new URLSearchParams({ sort: "volume_24h", limit: String(UNISWAP_TOP_LIMIT), chainId: String(chain.id) })}`, apiKey);
      if (!response.ok) throw new Error(`Uniswap tokens (${chain.name}) responded ${response.status}`);
      const records = (((await response.json()) as { tokens?: UniswapTokenRecord[] }).tokens ?? []).filter((record) => record?.chainId === chain.id);
      const markets = await dexMarkets(chain.dexscreener, records.flatMap((record) => (typeof record.address === "string" ? [record.address] : [])));
      return records.flatMap((record) => fromUniswapToken(record, markets.get(String(record.address).toLowerCase())) ?? []);
    }),
  );
  for (const list of lists) if (list.status === "rejected") console.error("[spot] uniswap list failed:", list.reason);
  return lists.flatMap((list) => (list.status === "fulfilled" ? list.value : []));
}

/** Tokens on the EVM swap chains for any query (DexScreener search), when Uniswap is on. */
export async function searchUniswapListings(query: string): Promise<SpotListing[]> {
  if (!uniswapOn()) return [];
  return readDexSearch(await dexscreener(`/latest/dex/search?q=${encodeURIComponent(query)}`));
}

async function loadSpotListings(): Promise<SpotListing[]> {
  const [jupiter, arcus, uniswap] = await Promise.allSettled([jupiterListings(), arcusListings(), uniswapListings()]);
  if (arcus.status === "rejected") console.error("[spot] arcus listings failed:", arcus.reason);
  const listings = mergeListings(
    jupiter.status === "fulfilled" ? jupiter.value : [],
    arcus.status === "fulfilled" ? arcus.value : [],
    uniswap.status === "fulfilled" ? uniswap.value : [],
  );
  // An all-empty load is an outage: throwing keeps the cache's last good list.
  if (listings.length === 0 && (venueAvailable("jupiter") || venueAvailable("arcus") || uniswapOnRobinhood() || uniswapOn())) throw new Error("No spot venue answered");
  return listings;
}

/** Every spot pair the integrated venues offer right now (cached across requests). */
export const getSpotListings = unstable_cache(loadSpotListings, ["spot-listings-v3"], { revalidate: REVALIDATE_SECONDS });

/** Jupiter search (any token, verified or not) for queries outside the cached lists. */
export async function searchJupiterListings(query: string): Promise<SpotListing[]> {
  if (!venueAvailable("jupiter") || !jupServerConfig().apiKey) return [];
  return jupList(`/tokens/v2/search?query=${encodeURIComponent(query)}`);
}
