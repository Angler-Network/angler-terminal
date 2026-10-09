import "server-only";
import { unstable_cache } from "next/cache";
import { mapLimit } from "@/lib/async";
import { venueAvailable } from "@/lib/deployment";
import { pickQuote } from "@/lib/markets/model";
import { getMarkets } from "@/lib/markets/server";
import { CHAIN_IDS, QUOTE_SYMBOLS } from "@/lib/venues/arcus/config";
import { indicativeTokenPrice, pickArcusQuote } from "@/lib/venues/arcus/quote";
import { arcusFetch, readArcusServerConfig } from "@/lib/venues/arcus/server";
import { jupFetch, jupServerConfig } from "@/lib/venues/jupiter/server";
import { uniswapOnRobinhood } from "@/lib/venues/robinhood-sources";
import { EVM_SWAP_CHAINS, isNativeToken, wrappedNative } from "@/lib/venues/uniswap/chains";
import { readUniswapServerConfig, uniswapFetch } from "@/lib/venues/uniswap/server";
import { DEXSCREENER_BATCH, readDexMarkets, readDexSearch } from "./dexscreener";
import { LLAMA_BATCH, llamaKey, readLlamaMarkets } from "./llama";
import { GECKO_TOKENS_BATCH } from "./gecko-tokens";
import { decodeMarket, encodeMarket, fillMarket, needsStats } from "./market-memory";
import { getOnchainTokenStats, getPonsTokens, getTopPoolTokens } from "./pool-candles-server";
import type { PoolNetwork } from "./pool-candles";
import { redisConfig, redisPipeline } from "@/lib/redis";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import { lighterConfig } from "@/lib/venues/lighter/config";
import { bookSpotListing, HL_SPOT_MIN_VOLUME_USD, readHlSpotMarkets, readLighterSpotMarkets } from "./book-spot";
import { readRelayCurrencies, relayCurrenciesBody } from "./relay-currencies";
import { readRelayServerConfig, relayFetch } from "@/lib/venues/relay-server";
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
/** Jupiter's category lists return at most 100 tokens each. */
const TOP_LIMIT = 100;
/** Uniswap tokens listed per EVM chain: the most traded, plus the deepest pools (the API allows up to 1000 each). */
const UNISWAP_TOP_LIMIT = 300;
const UNISWAP_TVL_LIMIT = 150;
/**
 * Chains loaded at once. All 25 at once sent ~50 Uniswap requests together, and the rate limit dropped whole chains
 * (Ethereum, Robinhood and with it every Pons launch) from the list.
 */
const UNISWAP_CHAIN_CONCURRENCY = 5;
const UNISWAP_RETRY_MS = 1500;
/** Each chain's last good list (per server instance): a chain that fails a refresh keeps it instead of vanishing. */
const lastChainListings = new Map<number, SpotListing[]>();
const LLAMA_URL = "https://coins.llama.fi";
const DEXSCREENER_URL = "https://api.dexscreener.com";
const DEXSCREENER_TIMEOUT_MS = 10_000;

async function jupList(path: string): Promise<SpotListing[]> {
  const response = await jupFetch(path);
  if (!response.ok) throw new Error(`Jupiter ${path} responded ${response.status}`);
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? (body as JupListingRecord[]).flatMap((record) => fromJupRecord(record) ?? []) : [];
}

/**
 * Jupiter's own lists: the most traded, most organically traded and trending tokens over the day and the last six
 * hours, plus tokenized stocks (several hundred distinct tokens once merged).
 */
async function jupiterListings(): Promise<SpotListing[]> {
  if (!venueAvailable("jupiter") || !jupServerConfig().apiKey) return [];
  const lists = await Promise.allSettled([
    jupList(`/tokens/v2/toptraded/24h?limit=${TOP_LIMIT}`),
    jupList(`/tokens/v2/toporganicscore/24h?limit=${TOP_LIMIT}`),
    jupList(`/tokens/v2/toptrending/24h?limit=${TOP_LIMIT}`),
    jupList(`/tokens/v2/toptraded/6h?limit=${TOP_LIMIT}`),
    jupList(`/tokens/v2/toporganicscore/6h?limit=${TOP_LIMIT}`),
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
  if (readArcusServerConfig(process.env).network === "testnet") return arcusTestnetListings(body);
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

const TESTNET_PROBE_USD = 100;

/**
 * Testnet: the router quotes only some of its mock tokens (often just TSLA), and perp prices mean nothing for them.
 * Each tradable token is priced from the router's own `/v1/price` for $100 of the test stablecoin, and tokens it
 * can't quote are left out instead of showing a card that never fills. A handful of calls per refresh.
 */
async function arcusTestnetListings(body: unknown[]): Promise<SpotListing[]> {
  const records = body as Array<Record<string, unknown>>;
  const stable = records.find((record) => record.symbol === QUOTE_SYMBOLS.testnet);
  if (!stable || typeof stable.address !== "string" || typeof stable.decimals !== "number") return [];
  const sellAmount = String(TESTNET_PROBE_USD * 10 ** stable.decimals);
  const listings = await Promise.all(
    records.map(async (record) => {
      if (record.verified === false || typeof record.address !== "string" || typeof record.symbol !== "string" || typeof record.decimals !== "number") return null;
      const token = { address: record.address, symbol: record.symbol, name: typeof record.name === "string" ? record.name : record.symbol, category: String(record.category ?? "") };
      if (!fromArcusToken(token)) return null;
      try {
        const response = await arcusFetch(
          `/v1/price?${new URLSearchParams({ chainId: String(CHAIN_IDS.testnet), sellToken: stable.address as string, buyToken: record.address, sellAmount })}`,
          { cache: "no-store" },
        );
        const quote = response.ok ? pickArcusQuote<{ venue: string; buyAmount: string }>(await response.json()) : null;
        const price = indicativeTokenPrice(TESTNET_PROBE_USD, quote?.buyAmount, record.decimals);
        return price ? fromArcusToken(token, { price, changePct: 0 }) : null;
      } catch {
        return null;
      }
    }),
  );
  return listings.flatMap((listing) => (listing ? [{ ...listing, change24h: undefined }] : []));
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

/** GeckoTerminal calls per chain per refresh at most (free: ~10 a minute site-wide, shared with the pool charts). */
const GECKO_MAX_TOKENS_PER_CHAIN = GECKO_TOKENS_BATCH * 2;
const STATS_KEY = "angler:spot:evm-stats:v1";
const STATS_EXPIRE_SECONDS = 24 * 60 * 60;
const memoryStats = new Map<string, string>();

/** GeckoTerminal stats for tokens nothing else covered; a failed batch (429 included) only leaves those bare. */
async function geckoStats(network: PoolNetwork, addresses: string[]) {
  const markets = new Map<string, TokenMarket>();
  for (let index = 0; index < addresses.length; index += GECKO_TOKENS_BATCH) {
    try {
      for (const [address, market] of await getOnchainTokenStats(network, addresses.slice(index, index + GECKO_TOKENS_BATCH))) markets.set(address, market);
    } catch (error) {
      console.error("[spot] geckoterminal token stats failed:", error);
      break;
    }
  }
  return markets;
}

const statsField = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;

/** The last good volume / liquidity per token (Redis, memory without it), younger than `MARKET_MEMORY_TTL_MS`. */
async function recallStats(chainId: number, addresses: string[]) {
  const fields = addresses.map((address) => statsField(chainId, address));
  let values: unknown[] = fields.map((field) => memoryStats.get(field));
  if (redisConfig() && fields.length) {
    try {
      const [result] = await redisPipeline([["HMGET", STATS_KEY, ...fields]]);
      if (Array.isArray(result)) values = result;
    } catch (error) {
      console.error("[spot] stats memory read failed:", error);
    }
  }
  const recalled = new Map<string, TokenMarket>();
  addresses.forEach((address, index) => {
    const market = decodeMarket(values[index]);
    if (market) recalled.set(address.toLowerCase(), market);
  });
  return recalled;
}

async function rememberStats(chainId: number, markets: Map<string, TokenMarket>) {
  const entries = [...markets].flatMap(([address, market]) => {
    const encoded = encodeMarket(market);
    return encoded ? [[statsField(chainId, address), encoded] as const] : [];
  });
  if (entries.length === 0) return;
  for (const [field, value] of entries) memoryStats.set(field, value);
  if (!redisConfig()) return;
  try {
    await redisPipeline([["HSET", STATS_KEY, ...entries.flat()], ["EXPIRE", STATS_KEY, STATS_EXPIRE_SECONDS]]);
  } catch (error) {
    console.error("[spot] stats memory write failed:", error);
  }
}

/** DefiLlama prices and 24h changes for a chain's tokens, in batches; a failed batch only leaves those tokens bare. */
async function llamaMarkets(chain: string, addresses: string[]) {
  const markets = new Map<string, TokenMarket>();
  const batches = [];
  for (let index = 0; index < addresses.length; index += LLAMA_BATCH) batches.push(addresses.slice(index, index + LLAMA_BATCH).map((address) => llamaKey(chain, address)));
  const results = await Promise.allSettled(
    batches.map(async (keys) => {
      const path = keys.join(",");
      const [prices, changes] = await Promise.all([
        fetch(`${LLAMA_URL}/prices/current/${path}`, { signal: AbortSignal.timeout(DEXSCREENER_TIMEOUT_MS) }).then((response) => (response.ok ? response.json() : null)),
        fetch(`${LLAMA_URL}/percentage/${path}`, { signal: AbortSignal.timeout(DEXSCREENER_TIMEOUT_MS) })
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null),
      ]);
      return readLlamaMarkets(prices, changes);
    }),
  );
  for (const result of results) {
    if (result.status === "fulfilled") for (const [key, market] of result.value) markets.set(key, market);
    else console.error("[spot] defillama prices failed:", result.reason);
  }
  return markets;
}

/**
 * Uniswap's most traded tokens on each EVM swap chain (Trading API `/tokens`). Prices and 24h change: DefiLlama, else
 * the pool sources. Volume, liquidity and market cap: DexScreener, else GeckoTerminal for what it left bare, else the
 * last good numbers (up to 6 hours old), so a rate-limited refresh doesn't blank them.
 */
async function uniswapListings(): Promise<SpotListing[]> {
  const { apiKey } = readUniswapServerConfig(process.env);
  if (!venueAvailable("uniswap") || !apiKey) return [];
  const lists = await mapLimit([...EVM_SWAP_CHAINS], UNISWAP_CHAIN_CONCURRENCY, (chain) =>
    (async () => {
      const ranked = async (sort: "volume_24h" | "tvl", limit: number) => {
        const path = `/tokens?${new URLSearchParams({ sort, limit: String(limit), chainId: String(chain.id) })}`;
        let response = await uniswapFetch(path, apiKey);
        // One retry after a short wait when rate limited.
        if (response.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, UNISWAP_RETRY_MS));
          response = await uniswapFetch(path, apiKey);
        }
        if (!response.ok) throw new Error(`Uniswap tokens (${chain.name}, ${sort}) responded ${response.status}`);
        return (((await response.json()) as { tokens?: UniswapTokenRecord[] }).tokens ?? []).filter((record) => record?.chainId === chain.id);
      };
      // Volume first; the deepest pools add established tokens that trade less today. A failed TVL list only drops those.
      // A chain with busiest-pool tokens (Robinhood) keeps going when Uniswap ranks nothing there.
      const [byVolume, byTvl, byPools, pons] = await Promise.all([
        chain.poolTop ? ranked("volume_24h", UNISWAP_TOP_LIMIT).catch(() => []) : ranked("volume_24h", UNISWAP_TOP_LIMIT),
        ranked("tvl", UNISWAP_TVL_LIMIT).catch(() => []),
        chain.poolTop ? getTopPoolTokens(chain.pool, chain.id).catch(() => []) : [],
        chain.key === "robinhood" ? getPonsTokens().catch(() => []) : [],
      ]);
      const seen = new Set<string>();
      // Pons launches first, so a token another list also has keeps its Pons tag.
      const records = [...pons, ...byVolume, ...byTvl, ...byPools].filter((record) => {
        const key = String(record.address).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const weth = wrappedNative(chain).address;
      const addresses = records.flatMap((record) => (typeof record.address === "string" && !isNativeToken(record.address) ? [record.address] : []));
      const wanted = [...new Set([...addresses, weth])];
      const [prices, pools, remembered] = await Promise.all([llamaMarkets(chain.llama, wanted), dexMarkets(chain.dexscreener, wanted), recallStats(chain.id, wanted)]);
      // GeckoTerminal fills what DexScreener left bare and nothing recent remembers, a few calls at most per refresh.
      const lacking = wanted.filter((address) => needsStats(pools.get(address.toLowerCase())) && needsStats(remembered.get(address.toLowerCase())));
      const gecko = await geckoStats(chain.pool, lacking.slice(0, GECKO_MAX_TOKENS_PER_CHAIN));
      const fresh = new Map(wanted.map((address) => [address.toLowerCase(), fillMarket(pools.get(address.toLowerCase()), gecko.get(address.toLowerCase()))]));
      await rememberStats(chain.id, fresh);
      // Native ETH has no pool of its own: it trades at WETH's price. DefiLlama's price first, then the pool sources'.
      const marketOf = (address: string): TokenMarket => {
        const key = (isNativeToken(address) ? weth : address).toLowerCase();
        return fillMarket(prices.get(llamaKey(chain.llama, key)), fresh.get(key), remembered.get(key));
      };
      // The native coin (address 0) keeps its own name: pool sources label it after the wrapped token ("WETH"), which
      // listed it twice next to the real WETH.
      const native = chain.pay.find((token) => isNativeToken(token.address));
      return records.flatMap((record) => {
        const named = native && typeof record.address === "string" && isNativeToken(record.address) ? { ...record, symbol: native.symbol, name: chain.nativeName } : record;
        return fromUniswapToken(named, marketOf(String(record.address))) ?? [];
      });
    })().then(
      (listings) => {
        if (listings.length > 0) lastChainListings.set(chain.id, listings);
        return listings.length > 0 ? listings : (lastChainListings.get(chain.id) ?? []);
      },
      (error: unknown) => {
        console.error(`[spot] uniswap list failed (${chain.name}):`, error);
        return lastChainListings.get(chain.id) ?? [];
      },
    ),
  );
  return lists.flat();
}

/**
 * Tokens on the EVM swap chains for any query, when Uniswap is on: Relay's token search (decimals and logos) and
 * DexScreener's when it answers, priced from DefiLlama.
 */
export async function searchUniswapListings(query: string): Promise<SpotListing[]> {
  if (!uniswapOn()) return [];
  const { apiKey } = readRelayServerConfig(process.env);
  const [relay, dex] = await Promise.allSettled([
    relayFetch("/currencies/v2", apiKey, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(relayCurrenciesBody(query, EVM_SWAP_CHAINS.map((chain) => chain.id))),
    }).then(async (response) => (response.ok ? readRelayCurrencies(await response.json()) : [])),
    dexscreener(`/latest/dex/search?q=${encodeURIComponent(query)}`).then(readDexSearch),
  ]);
  const hits = mergeListings(relay.status === "fulfilled" ? relay.value : [], dex.status === "fulfilled" ? dex.value : []);
  // One DefiLlama call per chain prices the hits.
  const priced = await Promise.all(
    EVM_SWAP_CHAINS.map(async (chain) => {
      const onChain = hits.filter((hit) => hit.chainId === chain.id);
      if (onChain.length === 0) return [];
      const prices = await llamaMarkets(chain.llama, onChain.map((hit) => hit.address)).catch(() => new Map<string, TokenMarket>());
      return onChain.map((hit) => {
        const market = prices.get(llamaKey(chain.llama, hit.address));
        return market ? { ...hit, price: hit.price ?? market.price, change24h: hit.change24h ?? market.change24h } : hit;
      });
    }),
  );
  return priced.flat();
}

/**
 * Hyperliquid's USDC spot pairs with some volume and Lighter's spot markets, on the network each venue is pinned to
 * (testnet and mainnet both have them, unlike the pool venues).
 */
async function bookSpotListings(): Promise<SpotListing[]> {
  const [hl, lighter] = await Promise.allSettled([
    venueAvailable("hyperliquid")
      ? fetch(`${hlConfig.apiUrl}/info`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "spotMetaAndAssetCtxs" }),
          signal: AbortSignal.timeout(DEXSCREENER_TIMEOUT_MS),
        }).then(async (response) => {
          if (!response.ok) throw new Error(`Hyperliquid spot responded ${response.status}`);
          return readHlSpotMarkets(await response.json(), HL_SPOT_MIN_VOLUME_USD[hlConfig.network]);
        })
      : [],
    venueAvailable("lighter")
      ? fetch(`${lighterConfig.apiUrl}/api/v1/orderBookDetails?filter=spot`, { signal: AbortSignal.timeout(DEXSCREENER_TIMEOUT_MS) }).then(async (response) => {
          if (!response.ok) throw new Error(`Lighter spot responded ${response.status}`);
          return readLighterSpotMarkets(await response.json());
        })
      : [],
  ]);
  if (hl.status === "rejected") console.error("[spot] hyperliquid spot failed:", hl.reason);
  if (lighter.status === "rejected") console.error("[spot] lighter spot failed:", lighter.reason);
  return [...(hl.status === "fulfilled" ? hl.value : []), ...(lighter.status === "fulfilled" ? lighter.value : [])].map(bookSpotListing);
}

async function loadSpotListings(): Promise<SpotListing[]> {
  const [jupiter, arcus, uniswap, book] = await Promise.allSettled([jupiterListings(), arcusListings(), uniswapListings(), bookSpotListings()]);
  if (arcus.status === "rejected") console.error("[spot] arcus listings failed:", arcus.reason);
  // Robinhood stock tokens trade on Uniswap too: they stay listed once, as Arcus (the swap card quotes both anyway).
  const arcusTokens = new Set((arcus.status === "fulfilled" ? arcus.value : []).map((listing) => listing.address.toLowerCase()));
  const listings = mergeListings(
    jupiter.status === "fulfilled" ? jupiter.value : [],
    arcus.status === "fulfilled" ? arcus.value : [],
    uniswap.status === "fulfilled" ? uniswap.value.filter((listing) => !(listing.chainId === 4663 && arcusTokens.has(listing.address.toLowerCase()))) : [],
    book.status === "fulfilled" ? book.value : [],
  );
  // An all-empty load is an outage: throwing keeps the cache's last good list.
  const anyVenue = venueAvailable("jupiter") || venueAvailable("arcus") || venueAvailable("hyperliquid") || venueAvailable("lighter") || uniswapOnRobinhood() || uniswapOn();
  if (listings.length === 0 && anyVenue) throw new Error("No spot venue answered");
  return listings;
}

/** Every spot pair the integrated venues offer right now (cached across requests). */
export const getSpotListings = unstable_cache(loadSpotListings, ["spot-listings-v5"], { revalidate: REVALIDATE_SECONDS });

/** Jupiter search (any token, verified or not) for queries outside the cached lists. */
export async function searchJupiterListings(query: string): Promise<SpotListing[]> {
  if (!venueAvailable("jupiter") || !jupServerConfig().apiKey) return [];
  return jupList(`/tokens/v2/search?query=${encodeURIComponent(query)}`);
}
