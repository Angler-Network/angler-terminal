/**
 * Market categories for the Markets page. Venues don't label asset classes consistently: Hyperliquid's stock dex
 * (xyz) also lists commodities, FX and indices, and Lighter labels nothing. So the category comes from the symbol
 * first (curated lists checked against both venues' live markets on 2026-10-06), then the venue's stock/crypto kind.
 */
export type MarketCategory = "crypto" | "stocks" | "indices" | "commodities" | "fx" | "preipo";

export const MARKET_CATEGORIES: Array<{ value: MarketCategory; label: string }> = [
  { value: "crypto", label: "Crypto" },
  { value: "stocks", label: "Stocks" },
  { value: "indices", label: "Indices & ETFs" },
  { value: "commodities", label: "Commodities" },
  { value: "fx", label: "FX" },
  { value: "preipo", label: "Pre-IPO" },
];

const COMMODITIES = new Set([
  "GOLD", "XAU", "SILVER", "XAG", "PLATINUM", "XPT", "PALLADIUM", "XPD", "COPPER", "XCU", "ALUMINIUM",
  "CL", "WTI", "BRENTOIL", "NATGAS", "TTF", "HO", "URANIUM", "URA", "CORN", "WHEAT", "H100",
]);

const INDICES = new Set([
  "XYZ100", "SP500", "US500", "US100", "JP225", "KR200", "KRCOMP", "NIFTY", "IBOV", "VIX", "VOL", "US10Y", "TLT",
  "SPY", "QQQ", "IWM", "SMH", "SOXX", "SOXL", "SOXS", "XLE", "XBI", "EWY", "EWJ", "EWZ", "EWT", "KORU", "URNM", "MAGS",
  "BOTZ", "SNXX",
]);

const PRE_IPO = new Set(["OPENAI", "ANTHROPIC", "SPACEX", "SPCX", "SHEIN", "UNITREE", "CXMT", "YMTC", "ZHIPU", "MINIMAX", "STABLECOINX", "OURA"]);

const CURRENCIES = "USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD|HKD|KRW|CNH|SGD|INR|MXN|BRL|TRY";
/** Single currencies on Hyperliquid (EUR, JPY), pairs on Lighter (EURUSD, USDJPY), and the dollar index. */
const FX = new RegExp(`^(?:(?:${CURRENCIES})(?:${CURRENCIES})|EUR|GBP|JPY|KRW|DXY)$`);

export function marketCategory(symbol: string, kind: "crypto" | "stock"): MarketCategory {
  const upper = symbol.toUpperCase();
  if (COMMODITIES.has(upper)) return "commodities";
  if (PRE_IPO.has(upper)) return "preipo";
  if (INDICES.has(upper)) return "indices";
  if (FX.test(upper)) return "fx";
  return kind === "stock" ? "stocks" : "crypto";
}
