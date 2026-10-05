import type { ChartDataSource, ChartMarket } from "@/lib/preferences";

export type ChartInterval = "15m" | "1h" | "4h" | "1d";

export const chartIntervals: ChartInterval[] = ["15m", "1h", "4h", "1d"];

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const CANDLE_COUNT = 1000;

const intervalMs: Record<ChartInterval, number> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

export function intervalDuration(interval: ChartInterval) {
  return intervalMs[interval];
}

async function binanceCandles(symbol: string, interval: ChartInterval, market: ChartMarket): Promise<Candle[]> {
  const base =
    market === "perp" ? "https://fapi.binance.com/fapi/v1/klines" : "https://data-api.binance.vision/api/v3/klines";
  const response = await fetch(`${base}?symbol=${symbol}USDT&interval=${interval}&limit=${CANDLE_COUNT}`);
  if (!response.ok) return [];
  const rows = (await response.json()) as [number, string, string, string, string, string][];
  return rows.map(([time, open, high, low, close, volume]) => ({
    time,
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
  }));
}

async function hyperliquidCoinCandles(coin: string, interval: ChartInterval): Promise<Candle[]> {
  const response = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: { coin, interval, startTime: Date.now() - intervalMs[interval] * CANDLE_COUNT },
    }),
  });
  if (!response.ok) return [];
  const rows = (await response.json()) as { t: number; o: string; h: string; l: string; c: string; v: string }[];
  return Array.isArray(rows)
    ? rows.map((row) => ({
        time: row.t,
        open: Number(row.o),
        high: Number(row.h),
        low: Number(row.l),
        close: Number(row.c),
        volume: Number(row.v),
      }))
    : [];
}

async function hyperliquidCandles(symbol: string, interval: ChartInterval, isStock: boolean) {
  return hyperliquidCoinCandles(isStock ? `xyz:${symbol}` : symbol, interval);
}

export async function loadCandles(
  symbol: string,
  interval: ChartInterval,
  options: { market: ChartMarket; sources: ChartDataSource[]; isStock: boolean },
): Promise<{ source: ChartDataSource; candles: Candle[] } | null> {
  const sources: ChartDataSource[] = options.isStock ? ["hyperliquid"] : options.sources;
  for (const source of sources) {
    try {
      const candles =
        source === "binance"
          ? await binanceCandles(symbol, interval, options.market)
          : await hyperliquidCandles(symbol, interval, options.isStock);
      if (candles.length > 0) return { source, candles };
    } catch {}
  }
  return null;
}
