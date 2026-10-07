"use client";

import dynamic from "next/dynamic";
import { ChevronDown, PencilLine } from "lucide-react";
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { usePreferences } from "@/components/app/preferences-provider";
import { useMarketList } from "@/components/app/use-market-list";
import { useAssetSearch } from "@/components/terminal/asset-search";
import { useSelectedAsset } from "@/components/terminal/selected-asset";
import { MarketStats, SpotStats } from "@/components/terminal/market-stats";
import { useTrading } from "@/components/terminal/trading-provider";
import { useT } from "@/lib/i18n/client";
import { formatPercent, formatPrice } from "@/lib/format";
import { pickQuote, type Market, type Quote } from "@/lib/markets/model";
import type { ChartInterval } from "@/lib/chart/candles";
import { tradingViewInterval, tradingViewSymbol } from "@/lib/chart/tradingview";
import type { NewsItem } from "@/lib/types";

import { fittingIntervalCount } from "@/lib/chart/interval-fit";
import { QuoteSlot, useInitialQuote } from "./initial-quote";
import { useSpotChartToken } from "./use-spot-chart-token";
import { IntervalPicker } from "./interval-picker";

const AnglerChart = dynamic(() => import("./angler-chart").then((module) => module.AnglerChart), { ssr: false });


function useIsStock(symbol: string) {
  const [kinds, setKinds] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (symbol in kinds) return;
    let isActive = true;
    fetch(`/api/markets?market=perp&symbols=${symbol}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((markets: Market[]) => {
        if (isActive) setKinds((current) => ({ ...current, [symbol]: markets[0]?.kind === "stock" }));
      })
      .catch(() => {
        if (isActive) setKinds((current) => ({ ...current, [symbol]: false }));
      });
    return () => {
      isActive = false;
    };
  }, [symbol, kinds]);
  return kinds[symbol];
}

const HEADER_GAP_PX = 12;
const STATS_FADE_PX = 16;

/**
 * How many quick interval buttons fit next to the market stats: whatever is left of the header after the asset,
 * price and the stats' full width. Re-measured when the header or the stats resize, and before paint on every
 * render, so the price appearing never wraps the intervals to a second row for a frame (a layout shift).
 */
function useQuickIntervalCount(hasStats: boolean) {
  const headerRef = useRef<HTMLElement>(null);
  const leadRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<(() => void) | null>(null);
  const [count, setCount] = useState<number | undefined>(undefined);
  // The count only depends on the asset, price and stats widths, so re-measuring settles after one pass.
  useLayoutEffect(() => measureRef.current?.());
  useLayoutEffect(() => {
    const header = headerRef.current;
    const stats = statsRef.current;
    if (!header) return;
    const measure = () => {
      const box = header.getBoundingClientRect();
      const inner = box.width - parseFloat(getComputedStyle(header).paddingRight);
      // The stats strip starts after the asset and price; its content keeps its natural width even when clipped.
      const strip = stats?.parentElement;
      const lead = leadRef.current?.getBoundingClientRect();
      // On phones the stats wrap to their own row, leaving the first row to the asset, the price and the intervals.
      const wrapped = strip && lead ? strip.getBoundingClientRect().top >= lead.bottom : false;
      const used = wrapped && lead
        ? lead.right - box.left
        : strip && stats
          ? strip.getBoundingClientRect().left - box.left + stats.offsetWidth + STATS_FADE_PX
          : inner / 2;
      setCount(fittingIntervalCount(inner - used - HEADER_GAP_PX));
    };
    measureRef.current = measure;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    if (stats) observer.observe(stats);
    if (leadRef.current) observer.observe(leadRef.current);
    return () => {
      measureRef.current = null;
      observer.disconnect();
    };
  }, [hasStats]);
  return { headerRef, leadRef, statsRef, count };
}

function useIsDarkTone(dependency: unknown) {
  const [isDark, setIsDark] = useState<boolean | null>(null);
  useEffect(() => {
    setIsDark(document.documentElement.dataset.tone === "dark");
  }, [dependency]);
  return isDark;
}

/** TradingView's advanced chart widget (from angler-news), opened on the selected asset. */
function TradingViewChart({ symbol, isStock, interval }: { symbol: string; isStock: boolean; interval: ChartInterval }) {
  const t = useT();
  const { preferences } = usePreferences();
  const isDark = useIsDarkTone(preferences.theme);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || isDark === null) return;
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget h-full w-full";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.type = "text/javascript";
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tradingViewSymbol(symbol, isStock),
      interval: tradingViewInterval(interval),
      timezone: preferences.timeZone,
      theme: isDark ? "dark" : "light",
      style: "1",
      locale: "en",
      allow_symbol_change: true,
      hide_side_toolbar: false,
      withdateranges: true,
      save_image: false,
      support_host: "https://www.tradingview.com",
    });
    // The widget is heavy, so let the feed finish loading before it starts.
    const mount = () => container.replaceChildren(widget, script);
    const idle = "requestIdleCallback" in window ? window.requestIdleCallback(mount, { timeout: 2000 }) : null;
    const timer = idle === null ? window.setTimeout(mount, 200) : null;
    return () => {
      if (idle !== null) window.cancelIdleCallback(idle);
      if (timer !== null) window.clearTimeout(timer);
      container.replaceChildren();
    };
  }, [isDark, preferences.timeZone, symbol, isStock, interval]);

  return <div ref={containerRef} role="region" aria-label={t("chart.title")} className="tradingview-widget-container min-h-0 w-full flex-1" />;
}

/** The traded token's logo, or the asset's icon when it has none or it fails to load (some sit on slow IPFS gateways). */
function SpotTokenIcon({ icon, symbol, isStock }: { icon?: string; symbol: string; isStock: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (icon && failed !== icon) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt="" width={20} height={20} onError={() => setFailed(icon)} className="size-5 shrink-0 rounded-full object-cover" />;
  }
  return <MarketIcon symbol={symbol} kind={isStock ? "stock" : "crypto"} size={20} />;
}

function PriceBlock({ quote }: { quote: Quote }) {
  return (
    <div className="flex shrink-0 flex-col gap-0.5 tabular-nums">
      <span className="text-[16px] font-semibold leading-none text-app-ink">{formatPrice(quote.price)}</span>
      {/* A spot token without a 24h figure yet shows only its price. */}
      {Number.isFinite(quote.changePct) && (
        <span className={`text-[11px] font-medium leading-none ${quote.changePct >= 0 ? "text-app-up" : "text-app-down"}`}>
          {quote.changePct >= 0 ? "+" : "-"}
          {formatPercent(quote.changePct)}
        </span>
      )}
    </div>
  );
}

const panelClass =
  "surface-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55 shadow-[0_1px_2px_rgba(19,35,58,0.05)]";

export function ChartPanel({ items }: { items: NewsItem[] }) {
  return <AnglerChartPanel items={items} />;
}

function AnglerChartPanel({ items }: { items: NewsItem[] }) {
  const t = useT();
  const { preferences, updatePreference } = usePreferences();
  const { symbol } = useSelectedAsset();
  const search = useAssetSearch();
  const { market: venueMarket } = useTrading();
  const interval = preferences.chartInterval;
  // The TradingView widget has its own interval bar and doesn't mark news, so it skips ours.
  const isTradingView = preferences.chart === "tradingview";
  const isStock = useIsStock(symbol);
  const markets = useMarketList(preferences.chartMarket);
  const selected = markets?.find((market) => market.symbol === symbol);
  const quote = selected ? pickQuote(selected, preferences.tapeSource)?.quote : undefined;
  // Until the browser's market list arrives, the price the server streamed in for this asset.
  const initialQuote = useInitialQuote();
  // On /spot the header and the candles are the traded token's (cbBTC, not "BTC"); null on /perp.
  const spotToken = useSpotChartToken();
  const liveQuote = spotToken ? (spotToken.price !== undefined ? { price: spotToken.price, changePct: spotToken.change24h ?? Number.NaN } : undefined) : quote;
  const fit = useQuickIntervalCount(Boolean(venueMarket || spotToken));

  return (
    <section aria-label={t("chart.title")} className={panelClass}>
      <header ref={fit.headerRef} className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-app-hairline px-3 py-2 lg:flex-nowrap">
        <div ref={fit.leadRef} className="flex shrink-0 items-center gap-3">
          {/* Opens the market search (components/terminal/asset-search.tsx), also on Ctrl/⌘+K. */}
          <button
            type="button"
            onClick={search.open}
            aria-haspopup="dialog"
            aria-label={`${spotToken?.symbol ?? symbol}. Search markets`}
            title="Search markets (Ctrl K)"
            className="flex h-9 w-[124px] shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-app-hairline-strong bg-app-card px-2.5 text-left transition-colors hover:border-app-focus focus-visible:ring-4 focus-visible:ring-app-ring/40 focus-visible:outline-hidden"
          >
            <SpotTokenIcon icon={spotToken?.icon} symbol={symbol} isStock={Boolean(isStock)} />
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-app-ink" title={spotToken ? `${spotToken.name} on ${spotToken.venue}` : undefined}>
              {spotToken?.symbol ?? symbol}
            </span>
            <ChevronDown className="size-4 shrink-0 text-app-muted" aria-hidden />
          </button>
          <Suspense fallback={null}>
            <QuoteSlot live={liveQuote} initial={markets || spotToken ? null : initialQuote} symbol={symbol}>
              {(shown) => <PriceBlock quote={shown} />}
            </QuoteSlot>
          </Suspense>
        </div>
        {spotToken ? (
          <SpotStats token={spotToken} contentRef={fit.statsRef} className="max-lg:order-last max-lg:basis-full" />
        ) : (
          <MarketStats market={venueMarket} contentRef={fit.statsRef} className="max-lg:order-last max-lg:basis-full" />
        )}
        {!isTradingView && <IntervalPicker maxQuick={fit.count} />}
        {/* Drawing tools live in the TradingView chart; this switches to it (and back) without opening Settings. */}
        <button
          type="button"
          onClick={() => updatePreference("chart", isTradingView ? "angler" : "tradingview")}
          title={isTradingView ? "Back to the Angler chart (news markers, venue candles)" : "Draw: trend lines, levels and indicators (TradingView chart)"}
          aria-pressed={isTradingView}
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-colors ${
            isTradingView ? "bg-app-accent/15 text-app-accent" : "text-app-muted hover:bg-app-chip hover:text-app-ink"
          }`}
        >
          <PencilLine className="size-3.5" aria-hidden />
          {isTradingView ? "Angler chart" : "Draw"}
        </button>
      </header>
      {isStock === undefined || venueMarket === undefined || spotToken === undefined ? (
        <div aria-hidden className="m-3 flex-1 animate-pulse rounded-xl bg-app-chip/60" />
      ) : isTradingView ? (
        <TradingViewChart symbol={symbol} isStock={isStock} interval={interval} />
      ) : (
        <AnglerChart symbol={symbol} interval={interval} isStock={isStock} items={items} venueMarket={venueMarket} spotToken={spotToken} />
      )}
    </section>
  );
}
