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
import { WatchlistPanel } from "./watchlist-panel";
import { NewsRulesRunner } from "./news-rules-runner";
import { OrderBook } from "./order-book";
import { OrderDraftProvider } from "./order-draft";
import { PanelResizer, type ResizeEdge } from "./panel-resizer";
import { PositionsBar } from "./positions-bar";
import { useSelectedAsset } from "./selected-asset";
import { useTrading } from "./trading-provider";
import { usePathname } from "next/navigation";
import { terminalKindOf } from "@/lib/terminal-kind";
import { columnTrack, COLUMN_RULES, maxColumnWidth, MIN_ORDERBOOK_HEIGHT, type ColumnPanel, type PanelSizes } from "@/lib/layout/panel-sizes";

type Slot = { column: string; row: string };

// Phones show every panel as a view; the watchlist stays desktop-only (the market search covers it there).
const allPanels: TerminalPanels = { orderbook: true, orderEntry: true, positions: true, news: true, account: true, watchlist: false };
const MIN_POSITIONS_HEIGHT = 80;
/** The chart keeps at least this much when the positions panel is dragged up (plus the 8px grid gap). */
const MIN_CHART_HEIGHT = 200;
/** Scrolling page mode (`fitToScreen` off): the chart row and the least the positions row gets. */
const SCROLL_CHART_HEIGHT = 620;
const SCROLL_MIN_POSITIONS = 360;
/** The order panel and account card keep at least this much above a dragged order book (also in its max-h class). */
const MIN_TRADING_HEIGHT = 200;
const GAP = 8;

/**
 * Modular desktop layout; every panel but the chart can be turned off (`panels` preference) and the chart takes
 * the free space:
 *   [ watchlist ][ chart              ][ order entry + account ][ news ]
 *   [           ][ positions / orders ][ order book            ][      ]
 * The watchlist is optional (off by default). The order book sits under the order panel so the chart gets the width.
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
  // Column widths and the order book height: live while dragging, saved (panelSizes preference) on release.
  const [dragSizes, setDragSizes] = useState<Partial<PanelSizes>>({});
  const sizes = { ...preferences.panelSizes, ...dragSizes };
  const columnRefs = { watchlist: useRef<HTMLDivElement>(null), side: useRef<HTMLDivElement>(null), news: useRef<HTMLDivElement>(null) };
  const orderBookRef = useRef<HTMLDivElement>(null);
  const resizer = (panel: keyof PanelSizes, edge: ResizeEdge, label: string, min: number, size: () => number, max: () => number) => (
    <PanelResizer
      edge={edge}
      label={label}
      size={size}
      min={min}
      max={max}
      onResize={(value) => setDragSizes((current) => ({ ...current, [panel]: value }))}
      onCommit={(value) => {
        updatePreference("panelSizes", { ...preferences.panelSizes, [panel]: value });
        setDragSizes({});
      }}
      onReset={() => {
        updatePreference("panelSizes", { ...preferences.panelSizes, [panel]: null });
        setDragSizes({});
      }}
    />
  );
  // A column handle sits on the edge facing the chart; the widest it may go leaves the chart its minimum.
  const columnResizer = (panel: ColumnPanel, edge: ResizeEdge, label: string) => {
    const width = (name: ColumnPanel) => columnRefs[name].current?.offsetWidth ?? 0;
    const others = () =>
      (Object.keys(columnRefs) as ColumnPanel[]).filter((name) => name !== panel && columnRefs[name].current).reduce((sum, name) => sum + width(name) + GAP, GAP);
    return resizer(panel, edge, label, COLUMN_RULES[panel].min, () => width(panel), () => maxColumnWidth(panel, gridRef.current?.clientWidth ?? 1600, others()));
  };
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
    // The optional watchlist leads; the chart takes the free width after it.
    const columns = panels.watchlist ? [columnTrack("watchlist", sizes.watchlist), "minmax(0,1fr)"] : ["minmax(0,1fr)"];
    const main = columns.length;
    const side = showSide ? columns.push(columnTrack("side", sizes.side)) : 0;
    const news = panels.news ? columns.push(columnTrack("news", sizes.news)) : 0;
    // min() keeps a saved height from squeezing the chart away on a shorter window.
    const rows = panels.positions ? `minmax(0,1fr) min(${positionsHeight}px, calc(100% - ${MIN_CHART_HEIGHT + 8}px))` : "minmax(0,1fr)";
    const allRows = panels.positions ? "1 / 3" : "1 / 2";
    const slot = (column: number | string, row: string): Slot => ({ column: String(column), row });
    // Scrolling page: a roomy chart and at least a comfortable positions panel, whatever the window height.
    const scrollRows = panels.positions ? `${SCROLL_CHART_HEIGHT}px ${Math.max(positionsHeight, SCROLL_MIN_POSITIONS)}px` : `${SCROLL_CHART_HEIGHT}px`;
    return {
      columns: columns.join(" "),
      rows,
      scrollRows,
      watchlist: slot(1, allRows),
      chart: slot(main, "1"),
      positions: slot(main, "2"),
      side: slot(side, allRows),
      news: slot(news, allRows),
    };
  }, [panels.watchlist, panels.news, panels.positions, showSide, positionsHeight, sizes.watchlist, sizes.side, sizes.news]);

  const place = (slot: Slot) => ({ "--col": slot.column, "--row": slot.row }) as React.CSSProperties;
  const placed = "min-h-0 lg:col-(--col) lg:row-(--row) lg:h-auto";
  // Phones and tablets show one view at a time (bottom tab bar), every panel available whatever the desktop layout.
  const mobileView = (name: MobileView) => `max-lg:h-full ${view === name ? "" : "max-lg:hidden"}`;
  // A dragged order book height; the cards above it take the rest of the column.
  const bookHeight = isMobile || !showTrading ? null : sizes.orderbook;
  const shown = { ...(isMobile ? allPanels : panels), ...(isSpot && { orderbook: false }) };

  return (
    <AssetSearchProvider>
    <OrderDraftProvider>
      <NewsRulesRunner items={feed.items} />
      <div
        ref={gridRef}
        style={{ "--cols": layout.columns, "--rows": layout.rows, "--rows-scroll": layout.scrollRows } as React.CSSProperties}
        className="terminal-grid h-full min-h-0 lg:grid lg:gap-2 lg:overflow-hidden lg:grid-cols-(--cols) lg:grid-rows-(--rows)"
      >
        {panels.watchlist && !isMobile && (
          <div ref={columnRefs.watchlist} style={place(layout.watchlist)} className={`relative ${placed} max-lg:hidden`}>
            {columnResizer("watchlist", "right", "Resize watchlist")}
            <WatchlistPanel />
          </div>
        )}
        <div data-mobile-view="chart" style={place(layout.chart)} className={`${placed} ${mobileView("chart")}`}>
          <ChartPanel items={chartItems} />
        </div>
        {(showSide || isMobile) && (
          <div ref={columnRefs.side} data-mobile-view="trade" style={place(layout.side)} className={`relative flex flex-col gap-2 max-lg:overflow-y-auto ${placed} ${mobileView("trade")}`}>
            {!isMobile && columnResizer("side", "left", "Resize trading column")}
            {(showTrading || isMobile) && <AccountPanel orderEntry={shown.orderEntry} account={shown.account} grow={!shown.orderbook || bookHeight !== null} />}
            {shown.orderbook && (
              <div
                ref={orderBookRef}
                style={bookHeight === null ? undefined : ({ "--book-h": `${bookHeight}px` } as React.CSSProperties)}
                className={`relative h-[420px] min-h-[260px] shrink-0 ${
                  bookHeight === null ? "lg:h-auto lg:flex-1 lg:shrink" : `lg:h-(--book-h) lg:max-h-[calc(100%-208px)] lg:min-h-0`
                }`}
              >
                {!isMobile && showTrading &&
                  resizer(
                    "orderbook",
                    "top",
                    "Resize order book",
                    MIN_ORDERBOOK_HEIGHT,
                    () => orderBookRef.current?.offsetHeight ?? 400,
                    () => (columnRefs.side.current?.clientHeight ?? 800) - MIN_TRADING_HEIGHT - GAP,
                  )}
                <OrderBook />
              </div>
            )}
          </div>
        )}
        {shown.news && (
          <div ref={columnRefs.news} data-mobile-view="news" style={place(layout.news)} className={`relative ${placed} ${mobileView("news")}`}>
            {!isMobile && columnResizer("news", "left", "Resize news")}
            <NewsFeed feed={feed} />
          </div>
        )}
        {shown.positions && (
          <div data-mobile-view="portfolio" style={isMobile ? undefined : place(layout.positions)} className={`relative ${placed} ${mobileView("portfolio")}`}>
            {!isMobile && (
              <PanelResizer
                label="Resize positions panel"
                size={() => positionsHeight}
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
