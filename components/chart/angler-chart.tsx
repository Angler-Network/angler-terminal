"use client";

import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useLang, useT } from "@/lib/i18n/client";
import { langTags } from "@/lib/i18n/config";
import { intervalDuration, loadCandles, type Candle, type ChartInterval } from "@/lib/chart/candles";
import type { ChartDataSource } from "@/lib/preferences";
import type { NewsItem } from "@/lib/types";
import { hyperliquidVenue } from "@/lib/venues/hyperliquid/venue";
import type { VenueMarket } from "@/lib/venues/types";

const REFRESH_MS = 30_000;

interface AnglerChartProps {
  symbol: string;
  interval: ChartInterval;
  isStock: boolean;
  items: NewsItem[];
  /** When the asset trades on Hyperliquid, candles come from the configured Hyperliquid network. */
  venueMarket?: VenueMarket | null;
}

const CANDLE_COUNT = 1000;

async function loadVenueCandles(market: VenueMarket, interval: ChartInterval) {
  try {
    const candles = await hyperliquidVenue.loadCandles(market, interval, Date.now() - intervalDuration(interval) * CANDLE_COUNT);
    return candles.length > 0 ? { source: "hyperliquid" as const, candles } : null;
  } catch {
    return null;
  }
}

interface ChartHandles {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
  markers: ISeriesMarkersPluginApi<Time>;
}

function readColor(name: string, alpha = 1) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).join(", ");
  return alpha === 1 ? `rgb(${value})` : `rgba(${value}, ${alpha})`;
}

function chartColors() {
  return {
    text: readColor("--app-muted"),
    grid: readColor("--app-hairline", 0.6),
    border: readColor("--app-hairline-strong"),
    up: readColor("--app-up"),
    down: readColor("--app-down"),
    upVolume: readColor("--app-up", 0.35),
    downVolume: readColor("--app-down", 0.35),
    accent: readColor("--app-accent"),
  };
}

const TOOLTIP_WIDTH = 256;
const PRICE_SCALE_WIDTH = 72;

function tooltipLeft(x: number, width: number) {
  const right = x + 14;
  if (right + TOOLTIP_WIDTH <= width - PRICE_SCALE_WIDTH) return right;
  return Math.max(8, x - 14 - TOOLTIP_WIDTH);
}

const toTime =(milliseconds: number) => Math.floor(milliseconds / 1000) as UTCTimestamp;

export function AnglerChart({ symbol, interval, isStock, items, venueMarket }: AnglerChartProps) {
  const t = useT();
  const locale = langTags[useLang()];
  const { preferences } = usePreferences();
  const containerRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<ChartHandles | null>(null);
  const [data, setData] = useState<{ key: string; source: ChartDataSource; candles: Candle[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const sources = useMemo(
    () =>
      [preferences.chartPrimarySource, preferences.chartFallbackSource].filter(
        (source): source is ChartDataSource => source !== "none",
      ),
    [preferences.chartPrimarySource, preferences.chartFallbackSource],
  );
  const venueCoin = venueMarket?.coin ?? "";
  const key = [symbol, interval, isStock, preferences.chartMarket, sources.join(), venueCoin].join("|");
  const candles = data?.key === key ? data.candles : null;
  const newsByTime = useMemo(() => {
    const groups = new Map<number, NewsItem[]>();
    if (!candles?.length) return groups;
    const duration = intervalDuration(interval);
    const first = candles[0].time;
    for (const item of items) {
      if (item.symbol !== symbol) continue;
      const at = Date.now() - item.minutesAgo * 60_000;
      if (at < first) continue;
      const time = toTime(first + Math.floor((at - first) / duration) * duration);
      groups.set(time, [...(groups.get(time) ?? []), item]);
    }
    return groups;
  }, [candles, items, symbol, interval]);
  const newsByTimeRef = useRef(newsByTime);
  newsByTimeRef.current = newsByTime;
  const [hovered, setHovered] = useState<{ time: number; x: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const colors = chartColors();
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: colors.text,
        fontFamily: "inherit",
        attributionLogo: false,
      },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { borderColor: colors.border, timeVisible: true, rightOffset: 4 },
      crosshair: { mode: 0 },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: colors.up,
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" } });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.2 } });
    chart.subscribeCrosshairMove((param) => {
      const time = Number(param.time);
      setHovered(param.point && newsByTimeRef.current.has(time) ? { time, x: param.point.x } : null);
    });
    handlesRef.current = {
      chart,
      candles: candleSeries,
      volume: volumeSeries,
      markers: createSeriesMarkers(candleSeries, []),
    };
    return () => {
      handlesRef.current = null;
      chart.remove();
    };
  }, [preferences.theme, preferences.marketColors, preferences.accent]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;
    const format = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, { timeZone: preferences.timeZone, ...options });
    const full = format({ month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const ticks = {
      [TickMarkType.Year]: format({ year: "numeric" }),
      [TickMarkType.Month]: format({ month: "short" }),
      [TickMarkType.DayOfMonth]: format({ day: "numeric" }),
      [TickMarkType.Time]: format({ hour: "2-digit", minute: "2-digit" }),
      [TickMarkType.TimeWithSeconds]: format({ hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };
    handles.chart.applyOptions({
      localization: { locale, timeFormatter: (time: Time) => full.format(Number(time) * 1000) },
      timeScale: { tickMarkFormatter: (time: Time, type: TickMarkType) => ticks[type].format(Number(time) * 1000) },
    });
  }, [locale, preferences.timeZone, preferences.theme, preferences.marketColors, preferences.accent]);

  useEffect(() => {
    let isActive = true;
    setFailed(false);
    const load = async () => {
      const result =
        (venueMarket ? await loadVenueCandles(venueMarket, interval) : null) ??
        (await loadCandles(symbol, interval, { market: preferences.chartMarket, sources, isStock }));
      if (!isActive) return;
      if (result) setData({ key, ...result });
      else setFailed(true);
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void load();
    }, REFRESH_MS);
    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
    // venueMarket is captured through venueCoin in key; its live prices must not restart polling.
  }, [key, symbol, interval, isStock, preferences.chartMarket, sources]);

  const fittedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;
    if (!candles) {
      handles.candles.setData([]);
      handles.volume.setData([]);
      handles.markers.setMarkers([]);
      fittedKeyRef.current = null;
      return;
    }
    const colors = chartColors();
    const price = Math.abs(candles[candles.length - 1]?.close ?? 1);
    const precision = price >= 1000 ? 1 : price >= 1 ? 2 : price >= 0.01 ? 4 : 6;
    const priceFormat = new Intl.NumberFormat(locale, { minimumFractionDigits: precision, maximumFractionDigits: precision });
    handles.candles.applyOptions({
      priceFormat: { type: "custom", minMove: 10 ** -precision, formatter: (value: number) => priceFormat.format(value) },
    });
    handles.candles.setData(
      candles.map((candle) => ({
        time: toTime(candle.time),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );
    handles.volume.setData(
      candles.map((candle) => ({
        time: toTime(candle.time),
        value: candle.volume,
        color: candle.close >= candle.open ? colors.upVolume : colors.downVolume,
      })),
    );
    handles.markers.setMarkers(
      [...newsByTime.keys()]
        .sort((a, b) => a - b)
        .map((time) => ({
          time: time as UTCTimestamp,
          position: "aboveBar" as const,
          shape: "circle" as const,
          size: 0.6,
          color: colors.accent,
        })),
    );
    if (fittedKeyRef.current !== key) {
      handles.chart.timeScale().setVisibleLogicalRange({ from: candles.length - 120, to: candles.length + 4 });
      fittedKeyRef.current = key;
    }
  }, [candles, newsByTime, key, locale, preferences.theme, preferences.marketColors, preferences.accent]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={containerRef} className="absolute inset-0" />
      {data && candles && (
        <span className="pointer-events-none absolute left-3 top-2 z-10 text-[11px] text-app-faint">
          {data.source === "binance" ? "Binance" : "Hyperliquid"}
        </span>
      )}
      {hovered && (
        <div
          className="surface-menu pointer-events-none absolute top-8 z-20 w-64 rounded-xl border border-app-hairline-strong bg-app-card px-3 py-2 shadow-[0_12px_32px_-12px_rgba(19,35,58,0.35)]"
          style={{ left: tooltipLeft(hovered.x, containerRef.current?.clientWidth ?? 0) }}
        >
          <ul className="flex flex-col gap-1.5">
            {(newsByTime.get(hovered.time) ?? []).map((item) => (
              <li key={item.id} className="flex gap-2 text-[12px] leading-snug text-app-ink">
                <span
                  aria-hidden
                  className={`mt-1 size-1.5 shrink-0 rounded-full ${item.direction === "up" ? "bg-app-up" : "bg-app-down"}`}
                />
                {item.headline}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!candles &&
        (failed ? (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-app-muted">
            {t("chart.unavailable")}
          </p>
        ) : (
          <div aria-hidden className="absolute inset-3 animate-pulse rounded-xl bg-app-chip/60" />
        ))}
    </div>
  );
}
