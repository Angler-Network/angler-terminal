"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIsMobile, useMobileView, type MobileView } from "@/components/app/mobile-view";
import { usePreferences } from "@/components/app/preferences-provider";
import type { TerminalPanels } from "@/lib/preferences";
import { ChartPanel } from "@/components/chart/chart-panel";
import { NewsFeed } from "@/components/news/news-feed";
import { useNewsFeed } from "@/lib/angler/use-news-feed";
import { durations, ease, ENTER_PROPS, motion } from "@/lib/motion";
import { AccountPanel, useHasWallet } from "./account-panel";
import { AssetSearchProvider } from "./asset-search";
import { NewsRulesRunner } from "./news-rules-runner";
import { OrderBook } from "./order-book";
import { OrderDraftProvider } from "./order-draft";
import { PanelResizer } from "./panel-resizer";
import { PositionsBar } from "./positions-bar";
import { useSelectedAsset } from "./selected-asset";
import { useTrading } from "./trading-provider";
import { usePathname } from "next/navigation";
import { terminalKindOf } from "@/lib/terminal-kind";

type Slot = { column: string; row: string };

const allPanels: TerminalPanels = { orderbook: true, orderEntry: true, positions: true, news: true, account: true };
const MIN_POSITIONS_HEIGHT = 80;
/** The chart keeps at least this much when the positions panel is dragged up (plus the 8px grid gap). */
const MIN_CHART_HEIGHT = 200;

/**
 * Modular desktop layout; every panel but the chart can be turned off (`panels` preference) and the chart takes
 * the free space:
 *   [ chart              ][ order entry + account ][ news ]
 *   [ positions / orders ][ order book            ][      ]
 * The order book sits under the order panel so the chart gets the width.
 * Below `lg` the panels become full-screen views picked from the bottom tab bar (`mobile-nav.tsx`).
 */
export function TerminalShell() {
  const { symbol, newsFocus } = useSelectedAsset();
  const { preferences, updatePreference } = usePreferences();
  const { newsFilters, panels, newsTranslate } = preferences;
  // With one asset in view, history is requested for that coin so its older news shows up too.
  const coin = newsFocus ?? (newsFilters.assets.length === 1 ? newsFilters.assets[0] : undefined);
  const feed = useNewsFeed({ minImportance: newsFilters.minImpact, coin, translate: newsTranslate });
  const hasWallet = useHasWallet();
  const isMobile = useIsMobile();
  const { view } = useMobileView();
  const { account } = useTrading();
  // An empty portfolio only needs room for its tabs and one line; rows get the full height.
  const autoPositionsHeight = (account?.positions.length ?? 0) + (account?.orders.length ?? 0) > 0 ? 240 : 132;
  // While dragging the live height lives here; it's saved (positionsHeight preference) on release.
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const positionsHeight = dragHeight ?? preferences.positionsHeight ?? autoPositionsHeight;
  const gridRef = useRef<HTMLDivElement>(null);
  const shownView = useRef(view);
  // Phones: the view picked in the tab bar fades in instead of popping.
  useLayoutEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    const gsap = motion();
    const panel = gridRef.current?.querySelector(`[data-mobile-view="${view}"]`);
    if (!isMobile || !gsap || !panel) return;
    const tween = gsap.from(panel, { opacity: 0, y: 8, duration: durations.base, ease: ease.soft, clearProps: ENTER_PROPS });
    return () => void tween.revert();
  }, [view, isMobile]);
  // The chart marks news on candles by item.symbol, so give each matching item the selected symbol.
  const chartItems = useMemo(
    () => feed.items.filter((item) => item.coins?.includes(symbol)).map((item) => ({ ...item, symbol })),
    [feed.items, symbol],
  );

  // Spot venues (Jupiter, Arcus) route through AMMs and have no order book: /spot shows the trading card alone.
  const isSpot = terminalKindOf(usePathname()) === "spot";
  const showTrading = panels.orderEntry || (panels.account && hasWallet);
  const showSide = showTrading || (panels.orderbook && !isSpot);
  const layout = useMemo(() => {
    const columns = ["minmax(0,1fr)"];
    const side = showSide ? columns.push("clamp(280px,20vw,340px)") : 0;
    const news = panels.news ? columns.push("clamp(290px,21vw,380px)") : 0;
    // min() keeps a saved height from squeezing the chart away on a shorter window.
    const rows = panels.positions ? `minmax(0,1fr) min(${positionsHeight}px, calc(100% - ${MIN_CHART_HEIGHT + 8}px))` : "minmax(0,1fr)";
    const allRows = panels.positions ? "1 / 3" : "1 / 2";
    const slot = (column: number | string, row: string): Slot => ({ column: String(column), row });
    return {
      columns: columns.join(" "),
      rows,
      chart: slot(1, "1"),
      positions: slot(1, "2"),
      side: slot(side, allRows),
      news: slot(news, allRows),
    };
  }, [panels.news, panels.positions, showSide, positionsHeight]);

  const place = (slot: Slot) => ({ "--col": slot.column, "--row": slot.row }) as React.CSSProperties;
  const placed = "min-h-0 lg:col-(--col) lg:row-(--row) lg:h-auto";
  // Phones and tablets show one view at a time (bottom tab bar), every panel available whatever the desktop layout.
  const mobileView = (name: MobileView) => `max-lg:h-full ${view === name ? "" : "max-lg:hidden"}`;
  const shown = { ...(isMobile ? allPanels : panels), ...(isSpot && { orderbook: false }) };

  return (
    <AssetSearchProvider>
    <OrderDraftProvider>
      <NewsRulesRunner items={feed.items} />
      <div
        ref={gridRef}
        style={{ "--cols": layout.columns, "--rows": layout.rows } as React.CSSProperties}
        className="h-full min-h-0 lg:grid lg:gap-2 lg:overflow-hidden lg:grid-cols-(--cols) lg:grid-rows-(--rows)"
      >
        <div data-mobile-view="chart" style={place(layout.chart)} className={`${placed} ${mobileView("chart")}`}>
          <ChartPanel items={chartItems} />
        </div>
        {(showSide || isMobile) && (
          <div data-mobile-view="trade" style={place(layout.side)} className={`flex flex-col gap-2 max-lg:overflow-y-auto ${placed} ${mobileView("trade")}`}>
            {(showTrading || isMobile) && <AccountPanel orderEntry={shown.orderEntry} account={shown.account} grow={!shown.orderbook} />}
            {shown.orderbook && (
              <div className="h-[420px] min-h-[260px] shrink-0 lg:h-auto lg:flex-1 lg:shrink">
                <OrderBook />
              </div>
            )}
          </div>
        )}
        {shown.news && (
          <div data-mobile-view="news" style={place(layout.news)} className={`${placed} ${mobileView("news")}`}>
            <NewsFeed feed={feed} />
          </div>
        )}
        {shown.positions && (
          <div data-mobile-view="portfolio" style={isMobile ? undefined : place(layout.positions)} className={`relative ${placed} ${mobileView("portfolio")}`}>
            {!isMobile && (
              <PanelResizer
                height={positionsHeight}
                min={MIN_POSITIONS_HEIGHT}
                max={() => (gridRef.current?.clientHeight ?? 800) - MIN_CHART_HEIGHT - 8}
                onResize={setDragHeight}
                onCommit={(height) => {
                  updatePreference("positionsHeight", height);
                  setDragHeight(null);
                }}
                onReset={() => {
                  updatePreference("positionsHeight", null);
                  setDragHeight(null);
                }}
              />
            )}
            <PositionsBar />
          </div>
        )}
      </div>
    </OrderDraftProvider>
    </AssetSearchProvider>
  );
}
