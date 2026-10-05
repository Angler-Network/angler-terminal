/** Lighter is a fallback only (not offered as the tape source): it answers from US servers when the others don't. */
export type MarketSource = "binance" | "hyperliquid" | "lighter";

export type MarketType = "spot" | "perp";

export interface Quote {
  price: number;
  changePct: number;
}

export interface Market {
  symbol: string;
  kind: "crypto" | "stock";
  volume: number;
  quotes: Partial<Record<MarketSource, Quote>>;
}

export interface TapeSettings {
  market: MarketType;
  source: MarketSource;
  symbols: string[] | null;
}

export const DEFAULT_TAPE_SYMBOLS = ["BTC", "ETH", "SOL", "HYPE", "XRP", "NVDA", "TSLA"];

export const DEFAULT_TAPE_MARKET: MarketType = "perp";

export const DEFAULT_TAPE_SOURCE: MarketSource = "binance";

export const MAX_TAPE_SYMBOLS = 30;

export type TapeMotion = "left" | "right" | "off";

export type TapeSpeed = "slow" | "normal" | "fast";

export const tapeMotions: TapeMotion[] = ["left", "right", "off"];

export const tapeSpeeds: TapeSpeed[] = ["slow", "normal", "fast"];

export const tapeSpeedPixelsPerSecond: Record<TapeSpeed, number> = { slow: 20, normal: 40, fast: 80 };

export const TAPE_COOKIE = "angler_tape";

export const marketSources: MarketSource[] = ["binance", "hyperliquid"];

export function isMarketType(value: unknown): value is MarketType {
  return value === "spot" || value === "perp";
}

export function isMarketSource(value: unknown): value is MarketSource {
  return value === "binance" || value === "hyperliquid";
}

export function readTapeSymbols(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return [
    ...new Set(
      value.filter((symbol): symbol is string => typeof symbol === "string" && /^[A-Za-z0-9]{1,20}$/.test(symbol)),
    ),
  ].slice(0, MAX_TAPE_SYMBOLS);
}

export function serializeTapeCookie(settings: TapeSettings) {
  return encodeURIComponent([settings.market, settings.source, settings.symbols?.join(",") ?? "*"].join("|"));
}

export function parseTapeCookie(value: string | undefined): TapeSettings {
  const [market, source, symbols] = value ? decodeURIComponent(value).split("|") : [];
  return {
    market: isMarketType(market) ? market : DEFAULT_TAPE_MARKET,
    source: isMarketSource(source) ? source : DEFAULT_TAPE_SOURCE,
    symbols: symbols === undefined || symbols === "*" ? null : readTapeSymbols(symbols ? symbols.split(",") : []),
  };
}

export function pickQuote(market: Market, source: MarketSource) {
  const order: MarketSource[] = [source, ...marketSources.filter((candidate) => candidate !== source), "lighter"];
  const found = order.find((candidate) => market.quotes[candidate]);
  return found ? { source: found, quote: market.quotes[found]! } : null;
}

export function pickMarkets(markets: Market[], symbols: string[]) {
  const bySymbol = new Map(markets.map((market) => [market.symbol, market]));
  return symbols.flatMap((symbol) => {
    const market = bySymbol.get(symbol);
    return market ? [market] : [];
  });
}
