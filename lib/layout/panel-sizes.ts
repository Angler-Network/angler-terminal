/** Sizes the user dragged on the desktop terminal; null keeps a panel's automatic size. */
export interface PanelSizes {
  /** Column widths in px. */
  watchlist: number | null;
  side: number | null;
  news: number | null;
  /** Order book height in px (the order panel and account card above it take the rest). */
  orderbook: number | null;
}

export type ColumnPanel = "watchlist" | "side" | "news";

export const defaultPanelSizes: PanelSizes = { watchlist: null, side: null, news: null, orderbook: null };

/** Each column's automatic width, its smallest dragged width and the share of the grid it may take at most. */
export const COLUMN_RULES: Record<ColumnPanel, { auto: string; min: number; maxShare: number }> = {
  watchlist: { auto: "clamp(220px,15vw,260px)", min: 180, maxShare: 0.25 },
  side: { auto: "clamp(280px,20vw,340px)", min: 260, maxShare: 0.32 },
  news: { auto: "clamp(290px,21vw,380px)", min: 260, maxShare: 0.32 },
};

export const MIN_ORDERBOOK_HEIGHT = 160;
/** The chart keeps at least this much width when a column is dragged wider. */
export const MIN_CHART_WIDTH = 360;
const MAX_SIZE = 4000;

/**
 * A column's grid track. A dragged width is capped at its share of the grid, so a width saved on a wide screen
 * can't squeeze the chart away on a smaller one.
 */
export function columnTrack(panel: ColumnPanel, width: number | null): string {
  const rule = COLUMN_RULES[panel];
  return width == null ? rule.auto : `min(${width}px, ${Math.round(rule.maxShare * 100)}%)`;
}

/** The widest a column may be dragged: its share of the grid, and never past the chart's minimum width. */
export function maxColumnWidth(panel: ColumnPanel, gridWidth: number, otherColumns: number): number {
  const rule = COLUMN_RULES[panel];
  return Math.max(rule.min, Math.min(gridWidth * rule.maxShare, gridWidth - otherColumns - MIN_CHART_WIDTH));
}

function readSize(value: unknown, min: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.min(Math.max(value, min), MAX_SIZE));
}

/** Validates stored sizes: anything missing or malformed falls back to the automatic size. */
export function readPanelSizes(value: unknown): PanelSizes {
  if (!value || typeof value !== "object") return defaultPanelSizes;
  const stored = value as Record<string, unknown>;
  return {
    watchlist: readSize(stored.watchlist, COLUMN_RULES.watchlist.min),
    side: readSize(stored.side, COLUMN_RULES.side.min),
    news: readSize(stored.news, COLUMN_RULES.news.min),
    orderbook: readSize(stored.orderbook, MIN_ORDERBOOK_HEIGHT),
  };
}
