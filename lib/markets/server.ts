import "server-only";
import { unstable_cache } from "next/cache";
import type { Market, MarketSource, MarketType, Quote } from "./model";

const HYPERLIQUID_INFO = "https://api.hyperliquid.xyz/info";
const BINANCE_SPOT = "https://data-api.binance.vision/api/v3/ticker/24hr?type=MINI";
const BINANCE_PERP = "https://fapi.binance.com/fapi/v1/ticker/24hr";
const STOCK_DEX = "xyz";
const REVALIDATE_SECONDS = 20;
const TIMEOUT_MS = 8000;
const QUOTE = "USDT";
const EXCLUDED_BASES = new Set(["USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD", "EUR", "EURI", "AEUR", "USD1", "XUSD", "BFUSD", "USDE"]);
const LEVERAGED_TOKEN = /(UP|DOWN|BULL|BEAR)$/;
const WRAPPED_SPOT_TOKENS: Record<string, string> = { UBTC: "BTC", UETH: "ETH", USOL: "SOL" };
const SYMBOL_PATTERN = /^[A-Za-z0-9]{1,20}$/;

interface Listing {
  symbol: string;
  kind: Market["kind"];
  volume: number;
  source: MarketSource;
  quote: Quote;
}

type HyperliquidPerpMeta = [
  { universe: Array<{ name: string; isDelisted?: boolean }> },
  Array<{ markPx?: string; prevDayPx?: string; dayNtlVlm?: string }>,
];

type HyperliquidSpotMeta = [
  { tokens: Array<{ name: string; index: number }>; universe: Array<{ name: string; tokens: [number, number] }> },
  Array<{ coin: string; markPx?: string; prevDayPx?: string; dayNtlVlm?: string }>,
];

interface BinanceTicker {
  symbol: string;
  openPrice: string;
  lastPrice: string;
  quoteVolume: string;
}

function toQuote(price: number, previous: number): Quote | null {
  if (!(price > 0) || !(previous > 0)) return null;
  return { price, changePct: ((price - previous) / previous) * 100 };
}

async function requestJson<T>(url: string, body?: unknown): Promise<T | null> {
  try {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

async function hyperliquidPerps(dex?: string): Promise<Listing[]> {
  const data = await requestJson<HyperliquidPerpMeta>(
    HYPERLIQUID_INFO,
    dex ? { type: "metaAndAssetCtxs", dex } : { type: "metaAndAssetCtxs" },
  );
  if (!data) return [];
  const [meta, contexts] = data;
  return meta.universe.flatMap((entry, index) => {
    const context = contexts[index];
    const quote = toQuote(Number(context?.markPx), Number(context?.prevDayPx));
    const symbol = dex ? entry.name.slice(dex.length + 1) : entry.name;
    if (entry.isDelisted || !quote || !SYMBOL_PATTERN.test(symbol)) return [];
    return [{ symbol, kind: dex ? "stock" : "crypto", volume: Number(context?.dayNtlVlm) || 0, source: "hyperliquid", quote }];
  });
}

async function hyperliquidSpot(): Promise<Listing[]> {
  const data = await requestJson<HyperliquidSpotMeta>(HYPERLIQUID_INFO, { type: "spotMetaAndAssetCtxs" });
  if (!data) return [];
  const [meta, contexts] = data;
  const tokens = new Map(meta.tokens.map((token) => [token.index, token.name]));
  const contextsByCoin = new Map(contexts.map((context) => [context.coin, context]));
  return meta.universe.flatMap((pair) => {
    const [base, quoteToken] = pair.tokens;
    if (tokens.get(quoteToken) !== "USDC") return [];
    const name = tokens.get(base) ?? "";
    const symbol = WRAPPED_SPOT_TOKENS[name] ?? name;
    const context = contextsByCoin.get(pair.name);
    const quote = toQuote(Number(context?.markPx), Number(context?.prevDayPx));
    const volume = Number(context?.dayNtlVlm) || 0;
    if (!quote || !(volume > 0) || !SYMBOL_PATTERN.test(symbol)) return [];
    return [{ symbol, kind: "crypto", volume, source: "hyperliquid", quote }];
  });
}

async function binance(url: string): Promise<Listing[]> {
  const tickers = await requestJson<BinanceTicker[]>(url);
  if (!Array.isArray(tickers)) return [];
  return tickers.flatMap((ticker) => {
    if (!ticker.symbol.endsWith(QUOTE)) return [];
    const symbol = ticker.symbol.slice(0, -QUOTE.length);
    const quote = toQuote(Number(ticker.lastPrice), Number(ticker.openPrice));
    const volume = Number(ticker.quoteVolume);
    if (!quote || !(volume > 0) || EXCLUDED_BASES.has(symbol) || LEVERAGED_TOKEN.test(symbol) || !SYMBOL_PATTERN.test(symbol)) {
      return [];
    }
    return [{ symbol, kind: "crypto", volume, source: "binance", quote }];
  });
}

function merge(listings: Listing[]): Market[] {
  const bySymbol = new Map<string, Market>();
  for (const listing of listings) {
    const market = bySymbol.get(listing.symbol) ?? { symbol: listing.symbol, kind: listing.kind, volume: 0, quotes: {} };
    if (listing.kind === "stock") market.kind = "stock";
    if (!market.quotes[listing.source]) market.quotes[listing.source] = listing.quote;
    market.volume += listing.volume;
    bySymbol.set(listing.symbol, market);
  }
  return [...bySymbol.values()].sort((a, b) => b.volume - a.volume);
}

async function loadMarkets(type: MarketType): Promise<Market[]> {
  const sources =
    type === "spot"
      ? [binance(BINANCE_SPOT), hyperliquidSpot()]
      : [binance(BINANCE_PERP), hyperliquidPerps(), hyperliquidPerps(STOCK_DEX)];
  return merge((await Promise.all(sources)).flat());
}

export const getMarkets = unstable_cache(loadMarkets, ["markets-v3"], { revalidate: REVALIDATE_SECONDS });
