import type { ChartDataSource, ChartMarket } from "@/lib/preferences";

/** Intervals both Binance klines and Hyperliquid candleSnapshot accept, with the same names. */
export const chartIntervals = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M"] as const;

export type ChartInterval = (typeof chartIntervals)[number];

export const intervalGroups: { label: string; intervals: ChartInterval[] }[] = [
  { label: "Minutes", intervals: ["1m", "3m", "5m", "15m", "30m"] },
  { label: "Hours", intervals: ["1h", "2h", "4h", "8h", "12h"] },
  { label: "Days", intervals: ["1d", "3d", "1w", "1M"] },
];

export const DEFAULT_FAVORITE_INTERVALS: ChartInterval[] = ["5m", "15m", "1h", "4h"];

export function isChartInterval(value: unknown): value is ChartInterval {
  return typeof value === "string" && (chartIntervals as readonly string[]).includes(value);
}

const unitNames: Record<string, [string, string]> = { m: ["minute", "minutes"], h: ["hour", "hours"], d: ["day", "days"], w: ["week", "weeks"], M: ["month", "months"] };

/** "15m" → "15 minutes", "1M" → "1 month". */
export function intervalLabel(interval: ChartInterval) {
  const count = Number(interval.slice(0, -1));
  const [one, many] = unitNames[interval.slice(-1)];
  return `${count} ${count === 1 ? one : many}`;
}

/** Compact button text: "15m", "4h", "1D", "1W", "1M". */
export function intervalShortLabel(interval: ChartInterval) {
  return /[dw]$/.test(interval) ? interval.toUpperCase() : interval;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const CANDLE_COUNT = 1000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const intervalMs: Record<ChartInterval, number> = {
  "1m": MINUTE,
  "3m": 3 * MINUTE,
  "5m": 5 * MINUTE,
  "15m": 15 * MINUTE,
  "30m": 30 * MINUTE,
  "1h": HOUR,
  "2h": 2 * HOUR,
  "4h": 4 * HOUR,
  "8h": 8 * HOUR,
  "12h": 12 * HOUR,
  "1d": DAY,
  "3d": 3 * DAY,
  "1w": 7 * DAY,
  // Calendar months vary; 30 days is close enough for bucketing news markers and the history window.
  "1M": 30 * DAY,
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
