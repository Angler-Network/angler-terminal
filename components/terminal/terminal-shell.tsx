"use client";

import { useMemo } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { ChartPanel } from "@/components/chart/chart-panel";
import { NewsFeed } from "@/components/news/news-feed";
import { useNewsFeed } from "@/lib/angler/use-news-feed";
import { AccountPanel, useHasWallet } from "./account-panel";
import { OrderBook } from "./order-book";
import { OrderDraftProvider } from "./order-draft";
import { PositionsBar } from "./positions-bar";
import { useSelectedAsset } from "./selected-asset";

type Slot = { column: string; row: string };

/**
 * Modular desktop layout; every panel but the chart can be turned off (`panels` preference) and the chart takes
 * the free space:
 *   [ chart      ][ book ][ order entry + account ][ news ]
 *   [ positions / orders ][                       ][      ]
 * On narrow screens the panels stack.
 */
export function TerminalShell() {
  const { symbol, newsFocus } = useSelectedAsset();
  const { newsFilters, panels } = usePreferences().preferences;
  // With one asset in view, history is requested for that coin so its older news shows up too.
  const coin = newsFocus ?? (newsFilters.assets.length === 1 ? newsFilters.assets[0] : undefined);
  const feed = useNewsFeed({ minImportance: newsFilters.minImpact, coin });
  const hasWallet = useHasWallet();
  // The chart marks news on candles by item.symbol, so give each matching item the selected symbol.
  const chartItems = useMemo(
    () => feed.items.filter((item) => item.coins?.includes(symbol)).map((item) => ({ ...item, symbol })),
    [feed.items, symbol],
  );

  const showSide = panels.orderEntry || (panels.account && hasWallet);
  const layout = useMemo(() => {
    const columns = ["minmax(0,1fr)"];
    const book = panels.orderbook ? columns.push("250px") : 0;
    const side = showSide ? columns.push("300px") : 0;
    const news = panels.news ? columns.push("360px") : 0;
    const rows = panels.positions ? "minmax(0,1fr) 220px" : "minmax(0,1fr)";
    const allRows = panels.positions ? "1 / 3" : "1 / 2";
    const mainEnd = book ? 3 : 2;
    const slot = (column: number | string, row: string): Slot => ({ column: String(column), row });
    return {
      columns: columns.join(" "),
      rows,
      chart: slot(1, "1"),
      book: slot(book, "1"),
      positions: slot(`1 / ${mainEnd}`, "2"),
      side: slot(side, allRows),
      news: slot(news, allRows),
    };
  }, [panels.orderbook, panels.news, panels.positions, showSide]);

  const place = (slot: Slot) => ({ "--col": slot.column, "--row": slot.row }) as React.CSSProperties;
  const placed = "min-h-0 lg:[grid-column:var(--col)] lg:[grid-row:var(--row)] lg:h-auto";

  return (
    <OrderDraftProvider>
      <div
        style={{ "--cols": layout.columns, "--rows": layout.rows } as React.CSSProperties}
        className="grid h-full min-h-0 grid-cols-1 gap-2 overflow-y-auto lg:overflow-hidden lg:[grid-template-columns:var(--cols)] lg:[grid-template-rows:var(--rows)]"
      >
        <div style={place(layout.chart)} className={`h-[460px] ${placed}`}>
          <ChartPanel items={chartItems} />
        </div>
        {panels.orderbook && (
          <div style={place(layout.book)} className={`h-[460px] ${placed}`}>
            <OrderBook />
          </div>
        )}
        {showSide && (
          <div style={place(layout.side)} className={placed}>
            <AccountPanel orderEntry={panels.orderEntry} account={panels.account} />
          </div>
        )}
        {panels.news && (
          <div style={place(layout.news)} className={`h-[600px] ${placed}`}>
            <NewsFeed feed={feed} />
          </div>
        )}
        {panels.positions && (
          <div style={place(layout.positions)} className={`h-[220px] ${placed}`}>
            <PositionsBar />
          </div>
        )}
      </div>
    </OrderDraftProvider>
  );
}
