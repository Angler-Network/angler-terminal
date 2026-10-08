"use client";

import { GripHorizontal } from "lucide-react";
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
import dynamic from "next/dynamic";
import { useBookVenueMarket, useSpotView } from "./use-book-spot";
import { useSelectedAsset } from "./selected-asset";
import { useTrading } from "./trading-provider";
import { usePathname } from "next/navigation";
import { terminalKindOf } from "@/lib/terminal-kind";
import { columnTrack, COLUMN_RULES, maxColumnWidth, MIN_ORDERBOOK_HEIGHT, type ColumnPanel, type PanelSizes } from "@/lib/layout/panel-sizes";
import { dropOnto, positionsSpanRail, type ArrangeTarget, type ColumnId, type StackPanel } from "@/lib/layout/arrangement";

// The panels under the chart on /swap and /spot load with their view, not with the perp terminal.
const SpotBookPanel = dynamic(() => import("./spot-book-panel").then((module) => module.SpotBookPanel));
const SwapHoldings = dynamic(() => import("./swap-holdings").then((module) => module.SwapHoldings));

type Slot = { column: string; row: string };

// Phones show every panel as a view; the watchlist stays desktop-only (the market search covers it there).
const allPanels: TerminalPanels = { orderbook: true, orderEntry: true, positions: true, news: true, account: true, watchlist: false };
const MIN_POSITIONS_HEIGHT = 80;
/** The chart keeps at least this much when the positions panel is dragged up (plus the 8px grid gap). */
const MIN_CHART_HEIGHT = 200;
/**
 * Scrolling page mode (`fitToScreen` off): the grid is always this tall (chart 620px over positions 360px by default),
 * so dragging the positions edge moves the line between them instead of stretching the side columns.
 */
const SCROLL_CHART_HEIGHT = 620;
const SCROLL_POSITIONS_HEIGHT = 360;
const SCROLL_GRID_HEIGHT = SCROLL_CHART_HEIGHT + 8 + SCROLL_POSITIONS_HEIGHT;
/** The order panel and account card keep at least this much above a dragged order book (also in its max-h class). */
const MIN_TRADING_HEIGHT = 200;
const GAP = 8;

/**
 * Modular desktop layout; every panel but the chart can be turned off (`panels` preference) and the chart takes
 * the free space. Default arrangement (`arrangement` preference, rearranged by dragging the handles):
 *   [ watchlist ][ chart                   ][ order book ][ order entry + account ]
 *   [           ][ positions / orders                    ][ news                  ]
 * The positions run under the order book whenever it has the column next to the chart (`positionsSpanRail`).
 * Columns swap places by dragging one onto another; the order book and news swap between the stack under the order
 * panel and the rail. The watchlist is optional (off by default).
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
  const scrollPositionsHeight = Math.min(dragHeight ?? preferences.positionsHeight ?? SCROLL_POSITIONS_HEIGHT, SCROLL_GRID_HEIGHT - MIN_CHART_HEIGHT - 8);
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

  // Spot venues (Jupiter, Arcus) route through AMMs and have no order book: /swap shows the trading card alone.
  const kind = terminalKindOf(usePathname());
  // /spot: the order book streams the view's Hyperliquid or Lighter spot market (null while it resolves); an Arcus stock
  // token has no book, so /spot shows it like /swap: the trading card alone, its activity under the chart.
  const spotView = useSpotView();
  const isSpot = kind === "spot" || (kind === "book" && spotView?.mode === "arcus");
  const bookRef = spotView === undefined ? undefined : spotView?.mode === "book" ? spotView.ref : null;
  const bookMarket = useBookVenueMarket(bookRef);
  const bookMarkets = kind === "book" ? (bookRef === undefined ? null : bookMarket ? [bookMarket] : []) : undefined;
  const orderBook = <OrderBook markets={bookMarkets} emptyText={kind === "book" ? `Hyperliquid and Lighter have no ${symbol} spot market.` : undefined} />;
  // Phones keep the classic split: the order book under the order panel, news as its own view.
  const arrangement = useMemo(() => (isMobile ? { ...preferences.arrangement, stack: "orderbook" as const } : preferences.arrangement), [isMobile, preferences.arrangement]);
  const stackPanel = arrangement.stack;
  const railPanel: StackPanel = stackPanel === "news" ? "orderbook" : "news";
  const shown = { ...(isMobile ? allPanels : panels), ...(isSpot && { orderbook: false }) };
  const showTrading = panels.orderEntry || (panels.account && hasWallet);
  const showStack = shown[stackPanel];
  const showRail = shown[railPanel];
  const showSide = showTrading || showStack;
  const layout = useMemo(() => {
    const visible = arrangement.columns.filter(
      (id) => id === "main" || (id === "watchlist" ? panels.watchlist && !isMobile : id === "trade" ? showSide : showRail),
    );
    const track: Record<ColumnId, string> = {
      watchlist: columnTrack("watchlist", sizes.watchlist),
      main: "minmax(0,1fr)",
      trade: columnTrack("side", sizes.side),
      rail: columnTrack("news", sizes.news),
    };
    const position = (id: ColumnId) => visible.indexOf(id) + 1;
    const span = panels.positions && !isMobile && positionsSpanRail(arrangement, visible);
    // min() keeps a saved height from squeezing the chart away on a shorter window.
    const rows = panels.positions ? `minmax(0,1fr) min(${positionsHeight}px, calc(100% - ${MIN_CHART_HEIGHT + 8}px))` : "minmax(0,1fr)";
    const allRows = panels.positions ? "1 / 3" : "1 / 2";
    const slot = (column: number | string, row: string): Slot => ({ column: String(column), row });
    // Scrolling page: a roomy chart and at least a comfortable positions panel, whatever the window height.
    const scrollRows = panels.positions ? `${SCROLL_GRID_HEIGHT - 8 - scrollPositionsHeight}px ${scrollPositionsHeight}px` : `${SCROLL_CHART_HEIGHT}px`;
    return {
      columns: visible.map((id) => track[id]).join(" "),
      rows,
      scrollRows,
      // Columns left of the chart resize from their right edge, the others from their left one.
      edge: (id: ColumnId): ResizeEdge => (position(id) < position("main") ? "right" : "left"),
      watchlist: slot(position("watchlist"), allRows),
      chart: slot(position("main"), "1"),
      positions: slot(span ? `${Math.min(position("main"), position("rail"))} / span 2` : position("main"), "2"),
      side: slot(position("trade"), allRows),
      news: slot(position("rail"), span ? "1" : allRows),
    };
  }, [arrangement, panels.watchlist, panels.positions, isMobile, showSide, showRail, positionsHeight, scrollPositionsHeight, sizes.watchlist, sizes.side, sizes.news]);

  const place = (slot: Slot) => ({ "--col": slot.column, "--row": slot.row }) as React.CSSProperties;
  const placed = "min-h-0 lg:col-(--col) lg:row-(--row) lg:h-auto";
  // Phones and tablets show one view at a time (bottom tab bar), every panel available whatever the desktop layout.
  const mobileView = (name: MobileView) => `max-lg:h-full ${view === name ? "" : "max-lg:hidden"}`;
  // A dragged stack height (order book or news under the order panel); the cards above it take the rest.
  const bookHeight = isMobile || !showTrading ? null : sizes.orderbook;

  // Drag to rearrange: a handle on each column and on the two movable panels; dropping swaps places.
  const [dragging, setDragging] = useState<ArrangeTarget | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const keyOf = (target: ArrangeTarget) => `${target.column ?? ""}:${target.panel ?? ""}`;
  const dropZone = (target: ArrangeTarget) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!dragging || !dropOnto(preferences.arrangement, dragging, target)) return;
      event.preventDefault();
      event.stopPropagation();
      setOver(keyOf(target));
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver((current) => (current === keyOf(target) ? null : current));
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const next = dragging && dropOnto(preferences.arrangement, dragging, target);
      if (next) updatePreference("arrangement", next);
      setDragging(null);
      setOver(null);
    },
  });
  const dropRing = (target: ArrangeTarget) => (over === keyOf(target) ? "ring-2 ring-app-accent ring-offset-2 ring-offset-transparent rounded-2xl" : "");
  const handle = (target: ArrangeTarget, label: string) =>
    isMobile ? null : (
      <ArrangeHandle
        label={label}
        onStart={() => setDragging(target)}
        onEnd={() => {
          setDragging(null);
          setOver(null);
        }}
      />
    );
  const panelLabel = (panel: StackPanel) => (panel === "news" ? "news" : "order book");

  const stackContent = (
    <div
      ref={orderBookRef}
      {...dropZone({ panel: stackPanel })}
      style={bookHeight === null ? undefined : ({ "--book-h": `${bookHeight}px` } as React.CSSProperties)}
      className={`group relative h-[420px] min-h-[260px] shrink-0 ${dropRing({ panel: stackPanel })} ${
        bookHeight === null ? "lg:h-auto lg:flex-1 lg:shrink" : `lg:h-(--book-h) lg:max-h-[calc(100%-208px)] lg:min-h-0`
      }`}
    >
      {!isMobile && showTrading &&
        resizer(
          "orderbook",
          "top",
          `Resize ${panelLabel(stackPanel)}`,
          MIN_ORDERBOOK_HEIGHT,
          () => orderBookRef.current?.offsetHeight ?? 400,
          () => (columnRefs.side.current?.clientHeight ?? 800) - MIN_TRADING_HEIGHT - GAP,
        )}
      {handle({ panel: stackPanel }, `Move the ${panelLabel(stackPanel)}`)}
      {stackPanel === "news" ? <NewsFeed feed={feed} /> : orderBook}
    </div>
  );

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
          <div
            ref={columnRefs.watchlist}
            {...dropZone({ column: "watchlist" })}
            style={place(layout.watchlist)}
            className={`group relative ${placed} max-lg:hidden ${dropRing({ column: "watchlist" })}`}
          >
            {columnResizer("watchlist", layout.edge("watchlist"), "Resize watchlist")}
            {handle({ column: "watchlist" }, "Move the watchlist column")}
            <WatchlistPanel />
          </div>
        )}
        <div
          data-mobile-view="chart"
          {...dropZone({ column: "main" })}
          style={place(layout.chart)}
          className={`group relative ${placed} ${mobileView("chart")} ${dropRing({ column: "main" })}`}
        >
          {handle({ column: "main" }, "Move the chart column")}
          <ChartPanel items={chartItems} />
        </div>
        {(showSide || isMobile) && (
          <div
            ref={columnRefs.side}
            data-mobile-view="trade"
            {...dropZone({ column: "trade" })}
            style={place(layout.side)}
            className={`group relative flex flex-col gap-2 max-lg:overflow-y-auto ${placed} ${mobileView("trade")} ${dropRing({ column: "trade" })}`}
          >
            {!isMobile && columnResizer("side", layout.edge("trade"), "Resize trading column")}
            {handle({ column: "trade" }, "Move the trading column")}
            {(showTrading || isMobile) && <AccountPanel orderEntry={shown.orderEntry} account={shown.account} grow={!showStack || bookHeight !== null} />}
            {showStack && stackContent}
          </div>
        )}
        {showRail && (
          <div
            ref={columnRefs.news}
            data-mobile-view={railPanel === "news" ? "news" : "trade"}
            {...dropZone({ column: "rail", panel: railPanel })}
            style={place(layout.news)}
            className={`group relative ${placed} ${mobileView(railPanel === "news" ? "news" : "trade")} ${dropRing({ column: "rail", panel: railPanel })}`}
          >
            {!isMobile && columnResizer("news", layout.edge("rail"), `Resize ${panelLabel(railPanel)}`)}
            {handle({ column: "rail", panel: railPanel }, `Move the ${panelLabel(railPanel)}`)}
            {railPanel === "news" ? <NewsFeed feed={feed} /> : orderBook}
          </div>
        )}
        {shown.positions && (
          <div data-mobile-view="portfolio" style={isMobile ? undefined : place(layout.positions)} className={`relative ${placed} ${mobileView("portfolio")}`}>
            {!isMobile && (
              <PanelResizer
                label="Resize positions panel"
                size={() => (preferences.fitToScreen ? positionsHeight : scrollPositionsHeight)}
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
            {/* /swap trades tokens, not positions: the wallet's tokens sit under the chart there. */}
            {isSpot ? <SwapHoldings /> : kind === "book" ? <SpotBookPanel /> : <PositionsBar />}
          </div>
        )}
      </div>
    </OrderDraftProvider>
    </AssetSearchProvider>
  );
}

/**
 * A small grip at the top of a column or movable panel, shown on hover. Drag it onto another column (or the order book
 * onto the news, and back) to swap their places.
 */
function ArrangeHandle({ label, onStart, onEnd }: { label: string; onStart: () => void; onEnd: () => void }) {
  return (
    <button
      type="button"
      draggable
      aria-label={label}
      title={`${label}: drag onto another panel to swap places`}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", label);
        onStart();
      }}
      onDragEnd={onEnd}
      className="absolute left-1/2 top-1 z-20 flex h-4 w-10 -translate-x-1/2 cursor-grab items-center justify-center rounded-full bg-app-chip/90 text-app-muted opacity-0 shadow-sm transition-opacity hover:text-app-ink focus-visible:opacity-100 active:cursor-grabbing group-hover:opacity-100 max-lg:hidden"
    >
      <GripHorizontal className="size-3.5" aria-hidden />
    </button>
  );
}
