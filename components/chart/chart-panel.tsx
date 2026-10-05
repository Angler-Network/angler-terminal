"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { usePreferences } from "@/components/app/preferences-provider";
import { SearchableSelect } from "@/components/app/searchable-select";
import { useMarketList } from "@/components/app/use-market-list";
import { useSelectedAsset } from "@/components/terminal/selected-asset";
import { useTrading } from "@/components/terminal/trading-provider";
import { useT } from "@/lib/i18n/client";
import { chartIntervals } from "@/lib/chart/candles";
import { formatPercent, formatPrice } from "@/lib/format";
import { pickQuote, type Market } from "@/lib/markets/model";
import type { NewsItem } from "@/lib/types";

const AnglerChart = dynamic(() => import("./angler-chart").then((module) => module.AnglerChart), { ssr: false });

const getSymbol = (market: Market) => market.symbol;
const getSearchText = (market: Market) => `${market.symbol} ${market.kind}`;

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

const panelClass =
  "surface-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55 shadow-[0_1px_2px_rgba(19,35,58,0.05)]";

export function ChartPanel({ items }: { items: NewsItem[] }) {
  return <AnglerChartPanel items={items} />;
}

function AnglerChartPanel({ items }: { items: NewsItem[] }) {
  const t = useT();
  const { preferences, updatePreference } = usePreferences();
  const { symbol, selectAsset } = useSelectedAsset();
  const { market: venueMarket } = useTrading();
  const interval = preferences.chartInterval;
  const isStock = useIsStock(symbol);
  const markets = useMarketList(preferences.chartMarket);
  const options = useMemo(() => {
    const list = markets ?? [];
    return list.some((market) => market.symbol === symbol)
      ? list
      : [{ symbol, kind: isStock ? "stock" : "crypto", volume: 0, quotes: {} } satisfies Market, ...list];
  }, [markets, symbol, isStock]);
  const selected = markets?.find((market) => market.symbol === symbol);
  const quote = selected ? pickQuote(selected, preferences.tapeSource)?.quote : undefined;

  return (
    <section aria-label={t("chart.title")} className={panelClass}>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-app-hairline px-3 py-2">
        <SearchableSelect
          compact
          className="w-[150px]"
          items={options}
          value={symbol}
          onChange={selectAsset}
          getKey={getSymbol}
          getSearchText={getSearchText}
          getDisplayValue={getSymbol}
          renderSelectedIcon={(market) => <MarketIcon symbol={market.symbol} kind={market.kind} size={20} />}
          renderOption={(market) => (
            <>
              <MarketIcon symbol={market.symbol} kind={market.kind} size={22} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-app-ink">{market.symbol}</span>
              <span className="shrink-0 text-[12px] text-app-muted">
                {market.kind === "stock" ? t("settings.tapeStock") : t("settings.tapeCrypto")}
              </span>
            </>
          )}
          label={t("chart.symbol")}
          placeholder={t("chart.symbol")}
          searchPlaceholder={t("settings.tapeSearch")}
          emptyMessage={t("settings.tapeNoMatch")}
        />
        {quote && (
          <div className="flex items-baseline gap-2 tabular-nums">
            <span className="text-[15px] font-semibold text-app-ink">{formatPrice(quote.price)}</span>
            <span className={`text-[13px] font-medium ${quote.changePct >= 0 ? "text-app-up" : "text-app-down"}`}>
              {quote.changePct >= 0 ? "+" : "-"}
              {formatPercent(quote.changePct)}
            </span>
          </div>
        )}
        <div role="group" aria-label={t("chart.interval")} className="ml-auto flex gap-0.5 rounded-lg bg-app-chip p-0.5">
          {chartIntervals.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={interval === value}
              onClick={() => updatePreference("chartInterval", value)}
              className={`h-7 rounded-md px-2 text-[12px] font-semibold uppercase transition-colors ${
                interval === value ? "bg-app-card text-app-ink shadow-sm" : "text-app-muted hover:text-app-ink"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </header>
      {isStock === undefined || venueMarket === undefined ? (
        <div aria-hidden className="m-3 flex-1 animate-pulse rounded-xl bg-app-chip/60" />
      ) : (
        <AnglerChart symbol={symbol} interval={interval} isStock={isStock} items={items} venueMarket={venueMarket} />
      )}
    </section>
  );
}
