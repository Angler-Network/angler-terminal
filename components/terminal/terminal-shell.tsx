"use client";

import { useMemo, useState } from "react";
import { ChartPanel } from "@/components/chart/chart-panel";
import { NewsFeed } from "@/components/news/news-feed";
import { useNewsFeed } from "@/lib/angler/use-news-feed";
import { OrderPanel } from "./order-panel";
import { PositionsBar } from "./positions-bar";
import { useSelectedAsset } from "./selected-asset";

/**
 * Desktop-first trading layout:
 *   [ chart            ][ order ][ news ]
 *   [ positions / orders bar   ][ news ]
 */
export function TerminalShell() {
  const { symbol } = useSelectedAsset();
  const [minImportance, setMinImportance] = useState(0);
  const feed = useNewsFeed({ minImportance });
  // The chart marks news on candles by item.symbol, so give each matching item the selected symbol.
  const chartItems = useMemo(
    () => feed.items.filter((item) => item.coins?.includes(symbol)).map((item) => ({ ...item, symbol })),
    [feed.items, symbol],
  );

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-2 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_280px_360px] lg:grid-rows-[minmax(0,1fr)_200px] lg:overflow-hidden">
      <div className="h-[460px] min-h-0 lg:col-start-1 lg:row-start-1 lg:h-auto">
        <ChartPanel items={chartItems} />
      </div>
      <div className="min-h-0 lg:col-start-2 lg:row-start-1">
        <OrderPanel />
      </div>
      <div className="h-[600px] min-h-0 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:h-auto">
        <NewsFeed feed={feed} minImportance={minImportance} onMinImportance={setMinImportance} />
      </div>
      <div className="h-[200px] min-h-0 lg:col-span-2 lg:col-start-1 lg:row-start-2 lg:h-auto">
        <PositionsBar />
      </div>
    </div>
  );
}
