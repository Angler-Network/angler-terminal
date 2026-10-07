import "server-only";
import { unstable_cache } from "next/cache";
import { venueAvailable } from "@/lib/deployment";
import { pickQuote } from "@/lib/markets/model";
import { getMarkets } from "@/lib/markets/server";
import { arcusFetch } from "@/lib/venues/arcus/server";
import { jupFetch, jupServerConfig } from "@/lib/venues/jupiter/server";
import { fromArcusToken, fromJupRecord, mergeListings, type JupListingRecord, type SpotListing } from "./listings";

const REVALIDATE_SECONDS = 120;
const TOP_LIMIT = 100;

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
  if (!venueAvailable("arcus")) return [];
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

async function loadSpotListings(): Promise<SpotListing[]> {
  const [jupiter, arcus] = await Promise.allSettled([jupiterListings(), arcusListings()]);
  if (arcus.status === "rejected") console.error("[spot] arcus listings failed:", arcus.reason);
  const listings = mergeListings(jupiter.status === "fulfilled" ? jupiter.value : [], arcus.status === "fulfilled" ? arcus.value : []);
  // An all-empty load is an outage: throwing keeps the cache's last good list.
  if (listings.length === 0 && (venueAvailable("jupiter") || venueAvailable("arcus"))) throw new Error("No spot venue answered");
  return listings;
}

/** Every spot pair the integrated venues offer right now (cached across requests). */
export const getSpotListings = unstable_cache(loadSpotListings, ["spot-listings-v1"], { revalidate: REVALIDATE_SECONDS });

/** Jupiter search (any token, verified or not) for queries outside the cached lists. */
export async function searchJupiterListings(query: string): Promise<SpotListing[]> {
  if (!venueAvailable("jupiter") || !jupServerConfig().apiKey) return [];
  return jupList(`/tokens/v2/search?query=${encodeURIComponent(query)}`);
}
