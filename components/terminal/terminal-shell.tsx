"use client";

import { useMemo, useState } from "react";
import { ChartPanel } from "@/components/chart/chart-panel";
import { NewsFeed } from "@/components/news/news-feed";
import { useNewsFeed } from "@/lib/angler/use-news-feed";
import { AccountPanel, useHasWallet } from "./account-panel";
import { PositionsBar } from "./positions-bar";
import { useSelectedAsset } from "./selected-asset";

/**
 * Desktop-first trading layout. The account column only appears once a wallet is connected:
 *   [ chart            ][ account ][ news ]      [ chart            ][ news ]
 *   [ positions / orders bar     ][ news ]      [ positions bar    ][ news ]
 */
export function TerminalShell() {
  const { symbol } = useSelectedAsset();
  const [minImportance, setMinImportance] = useState(0);
  const feed = useNewsFeed({ minImportance });
  const hasWallet = useHasWallet();
  // The chart marks news on candles by item.symbol, so give each matching item the selected symbol.
  const chartItems = useMemo(
    () => feed.items.filter((item) => item.coins?.includes(symbol)).map((item) => ({ ...item, symbol })),
    [feed.items, symbol],
  );

  return (
    <div
      className={`grid h-full min-h-0 grid-cols-1 gap-2 overflow-y-auto lg:grid-rows-[minmax(0,1fr)_220px] lg:overflow-hidden ${
        hasWallet ? "lg:grid-cols-[minmax(0,1fr)_290px_360px]" : "lg:grid-cols-[minmax(0,1fr)_360px]"
      }`}
    >
      <div className="h-[460px] min-h-0 lg:col-start-1 lg:row-start-1 lg:h-auto">
        <ChartPanel items={chartItems} />
      </div>
      {hasWallet && (
        <div className="min-h-0 lg:col-start-2 lg:row-start-1">
          <AccountPanel />
        </div>
      )}
      <div className={`h-[600px] min-h-0 lg:row-span-2 lg:row-start-1 lg:h-auto ${hasWallet ? "lg:col-start-3" : "lg:col-start-2"}`}>
        <NewsFeed feed={feed} minImportance={minImportance} onMinImportance={setMinImportance} />
      </div>
      <div className={`h-[200px] min-h-0 lg:col-start-1 lg:row-start-2 lg:h-auto ${hasWallet ? "lg:col-span-2" : ""}`}>
        <PositionsBar />
      </div>
    </div>
  );
}
