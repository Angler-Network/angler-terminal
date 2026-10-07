/**
 * Where the desktop terminal's panels sit, as the user arranged them by dragging: the order of the columns, and which
 * of the order book and the news feed sits under the order panel (the other one gets the rail column). Pure,
 * unit-tested; sizes live in `panel-sizes.ts`.
 */
export const COLUMN_IDS = ["watchlist", "main", "trade", "rail"] as const;
export type ColumnId = (typeof COLUMN_IDS)[number];

export type StackPanel = "orderbook" | "news";

export interface Arrangement {
  /** Left to right; `main` is the chart with the positions under it. */
  columns: ColumnId[];
  /** The panel under the order panel and account card; the other one fills the rail column. */
  stack: StackPanel;
  /** Set once read under the current default, so a layout the user keeps on purpose isn't migrated again. */
  version?: number;
}

const ARRANGEMENT_VERSION = 2;

/** Chart, then the order book (with the positions running under both), then the order panel with news under it. */
export const defaultArrangement: Arrangement = { columns: ["watchlist", "main", "rail", "trade"], stack: "news", version: ARRANGEMENT_VERSION };

/** The default before the order book moved next to the chart; saved copies of it move to the new default once. */
const PREVIOUS_DEFAULT = "watchlist,main,trade,rail:news";

export function readArrangement(value: unknown): Arrangement {
  const stored = (value ?? {}) as Partial<Arrangement> & { version?: number };
  const columns = Array.isArray(stored.columns) ? stored.columns : [];
  const valid = columns.length === COLUMN_IDS.length && COLUMN_IDS.every((id) => columns.includes(id));
  const arrangement: Arrangement = {
    columns: valid ? [...columns] : [...defaultArrangement.columns],
    stack: stored.stack === "orderbook" || stored.stack === "news" ? stored.stack : defaultArrangement.stack,
  };
  const untouched = stored.version !== ARRANGEMENT_VERSION && `${arrangement.columns.join(",")}:${arrangement.stack}` === PREVIOUS_DEFAULT;
  return untouched ? { ...defaultArrangement, columns: [...defaultArrangement.columns] } : { ...arrangement, version: ARRANGEMENT_VERSION };
}

/**
 * Whether the positions panel runs under the order book too: when the order book has the rail column to itself and
 * that column sits right next to the chart, it keeps the chart's height and the positions get its width.
 */
export function positionsSpanRail(arrangement: Arrangement, visible: ColumnId[]) {
  return arrangement.stack === "news" && visible.includes("rail") && Math.abs(visible.indexOf("rail") - visible.indexOf("main")) === 1;
}

export function swapColumns(arrangement: Arrangement, a: ColumnId, b: ColumnId): Arrangement {
  if (a === b) return arrangement;
  const columns = arrangement.columns.map((id) => (id === a ? b : id === b ? a : id));
  return { ...arrangement, columns };
}

export function swapStack(arrangement: Arrangement): Arrangement {
  return { ...arrangement, stack: arrangement.stack === "news" ? "orderbook" : "news" };
}

/** What a drag handle or a drop zone stands for: a column, a movable panel, or both (the rail is both). */
export interface ArrangeTarget {
  column?: ColumnId;
  panel?: StackPanel;
}

/**
 * The arrangement after dropping `source` on `target`: two different movable panels swap places; otherwise two
 * different columns swap. Null when the drop changes nothing.
 */
export function dropOnto(arrangement: Arrangement, source: ArrangeTarget, target: ArrangeTarget): Arrangement | null {
  if (source.panel && target.panel && source.panel !== target.panel) return swapStack(arrangement);
  if (source.column && target.column && source.column !== target.column) return swapColumns(arrangement, source.column, target.column);
  return null;
}
