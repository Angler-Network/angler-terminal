import type { ChartInterval } from "./candles";

/** Intervals the TradingView widget accepts; the others open on the nearest shorter one. */
const tradingViewIntervals: Record<ChartInterval, string> = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "2h": "120",
  "4h": "240",
  "8h": "240",
  "12h": "240",
  "1d": "D",
  "3d": "D",
  "1w": "W",
  "1M": "M",
};

export function tradingViewInterval(interval: ChartInterval) {
  return tradingViewIntervals[interval];
}

/**
 * TradingView symbol for a terminal symbol: crypto opens the Binance USDT perpetual, stocks (HIP-3 perps) the plain
 * ticker, which TradingView resolves to the listing exchange. The widget allows changing the symbol when a coin
 * isn't on Binance.
 */
export function tradingViewSymbol(symbol: string, isStock: boolean) {
  const clean = symbol.toUpperCase().replace(/^[A-Z0-9]+:/, "");
  return isStock ? clean : `BINANCE:${clean}USDT.P`;
}
