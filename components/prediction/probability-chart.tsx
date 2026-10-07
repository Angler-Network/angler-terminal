"use client";

import { AreaSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { PricePoint } from "@/lib/prediction/market-data";

function readColor(name: string, alpha = 1) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).join(", ");
  return alpha === 1 ? `rgb(${value})` : `rgba(${value}, ${alpha})`;
}

/** An outcome's probability over time, 0-100%, drawn as an area in the accent color. */
export function ProbabilityChart({ points }: { points: PricePoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handles = useRef<{ chart: IChartApi; series: ISeriesApi<"Area"> } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const accent = readColor("--app-accent");
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: readColor("--app-muted"), fontFamily: "inherit", attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: readColor("--app-hairline", 0.6) } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.05 } },
      timeScale: { borderVisible: false, timeVisible: true },
      crosshair: { mode: 0 },
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: accent,
      lineWidth: 2,
      topColor: readColor("--app-accent", 0.25),
      bottomColor: readColor("--app-accent", 0),
      priceFormat: { type: "custom", minMove: 0.1, formatter: (value: number) => `${value.toFixed(value < 10 ? 1 : 0)}%` },
      lastValueVisible: true,
      priceLineVisible: false,
    });
    handles.current = { chart, series };
    return () => {
      handles.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const current = handles.current;
    if (!current) return;
    current.series.setData(points.map((point) => ({ time: point.t as UTCTimestamp, value: point.p * 100 })));
    current.chart.timeScale().fitContent();
  }, [points]);

  return <div ref={containerRef} className="h-full w-full" />;
}
