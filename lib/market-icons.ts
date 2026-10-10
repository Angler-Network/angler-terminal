const HYPERLIQUID_ICONS = "https://app.hyperliquid.xyz/coins";
const BINANCE_ICONS = "https://bin.bnbstatic.com/static/assets/logos";
const STOCK_LOGOS = "https://financialmodelingprep.com/image-stock";
const PARQET_LOGOS = "https://assets.parqet.com/logos/symbol";
/** Lighter's own market icons (lowercase symbol): most of its 200+ perps, including ones no other source has. */
const LIGHTER_ICONS = "https://assets.lighter.xyz/fe/token";
/** Broad crypto coverage for listings the venues' own sets lack (JCT, LUMIA…). */
const TRADINGVIEW_ICONS = "https://s3-symbol-logo.tradingview.com/crypto/XTVC";
const OKX_ICONS = "https://static.okx.com/cdn/oksupport/asset/currency/icon";

export type MarketIconKind = "crypto" | "stock";

/**
 * A market's logo URLs, to try in order until one loads: the ones for the market's kind, then Lighter's, then the
 * other kind's (venues mislabel some markets, e.g. Lighter lists stocks next to tokens), then the same for the base
 * name of multiplied or USD-quoted tickers (1000PEPE / kPEPE → PEPE, SAMSUNGUSD → SAMSUNG).
 */
export function iconSources(symbol: string, kind: MarketIconKind | undefined): string[] {
  const unscaled = symbol.replace(/^1000+/, "").replace(/^k(?=[A-Z0-9]{2})/, "");
  const base = unscaled.length > 6 && unscaled.endsWith("USD") ? unscaled.slice(0, -3) : unscaled;
  return base && base !== symbol ? [...symbolSources(symbol, kind), ...symbolSources(base, kind)] : symbolSources(symbol, kind);
}

function symbolSources(symbol: string, kind: MarketIconKind | undefined) {
  const stock = [
    `${HYPERLIQUID_ICONS}/xyz:${symbol}.svg`,
    `${STOCK_LOGOS}/${symbol}.png`,
    `${PARQET_LOGOS}/${symbol}?format=png`,
  ];
  const crypto = [`${HYPERLIQUID_ICONS}/${symbol}.svg`, `${BINANCE_ICONS}/${symbol}.png`];
  const lighter = [`${LIGHTER_ICONS}/${symbol.toLowerCase()}.png`];
  const wide = [`${TRADINGVIEW_ICONS}${symbol}.svg`, `${OKX_ICONS}/${symbol.toLowerCase()}.png`];
  return kind === "stock" ? [...stock, ...lighter, ...crypto, ...wide] : [...crypto, ...lighter, ...wide, ...stock];
}
