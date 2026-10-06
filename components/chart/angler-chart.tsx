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
import { mergeCandles } from "@/lib/chart/merge-candles";
import type { ChartDataSource, ChartSource } from "@/lib/preferences";
import { useSelectedAsset } from "@/components/terminal/selected-asset";
import { useTrading } from "@/components/terminal/trading-provider";
import { findMarket } from "@/lib/venues/hyperliquid/markets";
import { LIGHTER_CANDLE_RESOLUTIONS } from "@/lib/venues/lighter/config";
import type { NewsItem } from "@/lib/types";
import { hyperliquidVenue } from "@/lib/venues/hyperliquid/venue";
import type { PerpVenueId, VenueMarket } from "@/lib/venues/types";

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

type CandleSource = "binance" | PerpVenueId;

/** Candles from a perp venue (its configured network) or from the public feeds (Binance, Hyperliquid mainnet). */
interface CandleData {
  key: string;
  origin: "venue" | "feed";
  source: CandleSource;
  candles: Candle[];
}

const SOURCE_NAMES: Record<CandleSource, string> = { binance: "Binance", hyperliquid: "Hyperliquid", lighter: "Lighter" };

/**
 * Candles straight from a perp venue for its market; null when it can't serve this asset or interval. `since` (ms)
 * fetches only the latest candles for a refresh.
 */
async function loadVenueCandles(venue: PerpVenueId, market: VenueMarket, interval: ChartInterval, since?: number) {
  if (venue === "lighter" && !LIGHTER_CANDLE_RESOLUTIONS.has(interval)) return null;
  try {
    // Lighter's venue module (and its signer) only loads when its candles are asked for.
    const source = venue === "hyperliquid" ? hyperliquidVenue : (await import("@/lib/venues/lighter/venue")).lighterVenue;
    const candles = await source.loadCandles(market, interval, since ?? Date.now() - intervalDuration(interval) * CANDLE_COUNT);
    return candles.length > 0 ? { origin: "venue" as const, source: venue as CandleSource, candles } : null;
  } catch {
    return null;
  }
}

/** Perp venues to try, in order: the chosen one (or the order panel's on "auto"), then the others. */
function venueOrder(chartSource: ChartSource, tradeVenue: PerpVenueId | null): PerpVenueId[] {
  const first = chartSource === "auto" ? tradeVenue : chartSource === "binance" ? null : chartSource;
  return [...new Set([first, "hyperliquid", "lighter"].filter((venue): venue is PerpVenueId => venue !== null))];
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
  const { preferences, updatePreference } = usePreferences();
  const containerRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<ChartHandles | null>(null);
  const [data, setData] = useState<CandleData | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const { tradeVenue } = useSelectedAsset();
  const { marketsByVenue } = useTrading();
  const [failed, setFailed] = useState(false);
  const sources = useMemo(
    () =>
      [preferences.chartPrimarySource, preferences.chartFallbackSource].filter(
        (source): source is ChartDataSource => source !== "none",
      ),
    [preferences.chartPrimarySource, preferences.chartFallbackSource],
  );
  // The Hyperliquid market comes from the panel (it knows the dex); Lighter's from its market list.
  const lighterList = marketsByVenue.lighter;
  const venueMarkets = useMemo<Partial<Record<PerpVenueId, VenueMarket | null>>>(
    () => ({ hyperliquid: venueMarket ?? null, lighter: lighterList ? findMarket(lighterList, symbol) : null }),
    [venueMarket, lighterList, symbol],
  );
  const venues = venueOrder(preferences.chartSource, tradeVenue).filter((venue) => venueMarkets[venue]);
  const venuesRef = useRef({ venues, venueMarkets });
  venuesRef.current = { venues, venueMarkets };
  // Only the first venue decides the candles: a fallback venue whose market list arrives later (Lighter's, a moment
  // after Hyperliquid's) must not clear the chart and download the same candles again.
  const venueKey = venues[0] ? `${venues[0]}:${venueMarkets[venues[0]]!.coin}` : "";
  const key = [symbol, interval, isStock, preferences.chartMarket, preferences.chartSource, sources.join(), venueKey].join("|");
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
    const options = { market: preferences.chartMarket, isStock };
    const load = async () => {
      const { venues, venueMarkets } = venuesRef.current;
      const fromVenues = async () => {
        for (const venue of venues) {
          const result = await loadVenueCandles(venue, venueMarkets[venue]!, interval);
          if (result) return result;
        }
        return null;
      };
      const feeds: ChartDataSource[] = preferences.chartSource === "binance" ? ["binance", "hyperliquid"] : sources;
      const fromFeeds = async () => {
        const result = await loadCandles(symbol, interval, { ...options, sources: feeds });
        return result && { origin: "feed" as const, ...result };
      };
      // "Binance" asks Binance first; every other choice asks the venues first, then the public feeds.
      const result = preferences.chartSource === "binance" ? ((await fromFeeds()) ?? (await fromVenues())) : ((await fromVenues()) ?? (await fromFeeds()));
      if (!isActive) return;
      if (result) setData({ key, ...result });
      else setFailed(true);
    };
    /** Refreshes fetch only from the last closed candle on (~70 kB less per tick than the full history). */
    const refresh = async () => {
      const current = dataRef.current;
      if (current?.key !== key || current.candles.length < 2) return load();
      const since = current.candles[current.candles.length - 2].time;
      const market = venuesRef.current.venueMarkets[current.source as PerpVenueId];
      const tail =
        current.origin === "venue"
          ? market
            ? await loadVenueCandles(current.source as PerpVenueId, market, interval, since)
            : null
          : await loadCandles(symbol, interval, { ...options, sources: [current.source as ChartDataSource], since });
      if (!isActive || !tail || dataRef.current !== current) return;
      setData({ ...current, candles: mergeCandles(current.candles, tail.candles, CANDLE_COUNT) });
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, REFRESH_MS);
    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
    // The venue markets are captured through venueKey in key; their live prices must not restart polling.
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
      <label className="absolute left-2 top-1.5 z-10">
        <span className="sr-only">Chart data source</span>
        <select
          value={preferences.chartSource}
          onChange={(event) => updatePreference("chartSource", event.target.value as ChartSource)}
          title="Where the candles come from. Auto follows the venue in the order panel."
          className="cursor-pointer rounded-md bg-transparent px-1 py-0.5 text-[11px] text-app-faint outline-none hover:bg-app-chip hover:text-app-ink focus-visible:ring-2 focus-visible:ring-app-ring"
        >
          {(["auto", "hyperliquid", "lighter", "binance"] as const).map((source) => (
            <option key={source} value={source} className="bg-app-dialog text-app-ink">
              {source === "auto"
                ? `Auto${data && candles ? ` · ${SOURCE_NAMES[data.source]}` : ""}`
                : // A pick the chart couldn't serve shows what it fell back to.
                  `${SOURCE_NAMES[source]}${data && candles && preferences.chartSource === source && data.source !== source ? ` → ${SOURCE_NAMES[data.source]}` : ""}`}
            </option>
          ))}
        </select>
      </label>
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
