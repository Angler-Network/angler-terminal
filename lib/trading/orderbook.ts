/**
 * Order book and trade tape model shared by the venues, plus their wire parsers. Pure, unit-tested.
 * Hyperliquid sends the whole book in every `l2Book` message; Lighter sends a snapshot, then changed levels
 * (size "0" removes a level).
 */

export interface BookLevel {
  price: number;
  size: number;
}

export interface BookSide {
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface TapeTrade {
  id: string;
  price: number;
  size: number;
  /** Taker side. */
  side: "buy" | "sell";
  time: number;
}

function level(price: unknown, size: unknown): BookLevel | null {
  const p = Number(price);
  const s = Number(size);
  return Number.isFinite(p) && p > 0 && Number.isFinite(s) && s >= 0 ? { price: p, size: s } : null;
}

const levels = (rows: unknown, read: (row: Record<string, unknown>) => BookLevel | null) =>
  (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const parsed = row && typeof row === "object" ? read(row as Record<string, unknown>) : null;
    return parsed ? [parsed] : [];
  });

/** Hyperliquid `l2Book` data (REST or WebSocket): `levels` is [bids, asks] of { px, sz, n }. */
export function readHlBook(data: unknown): BookSide | null {
  const rows = (data as { levels?: unknown } | null)?.levels;
  if (!Array.isArray(rows) || rows.length !== 2) return null;
  const read = (row: Record<string, unknown>) => level(row.px, row.sz);
  return { bids: levels(rows[0], read), asks: levels(rows[1], read) };
}

/** Hyperliquid `trades` data: side "B" is a taker buy, "A" a taker sell. */
export function readHlTrades(data: unknown): TapeTrade[] {
  return (Array.isArray(data) ? data : []).flatMap((row: Record<string, unknown>) => {
    const parsed = level(row?.px, row?.sz);
    if (!parsed || (row.side !== "B" && row.side !== "A")) return [];
    return [{ id: String(row.tid ?? `${row.time}-${row.px}`), ...parsed, side: row.side === "B" ? "buy" : "sell", time: Number(row.time) || 0 } as TapeTrade];
  });
}

/** Lighter `order_book` snapshot or update: changed levels on both sides. */
export function readLighterBook(message: unknown): BookSide | null {
  const book = (message as { order_book?: { bids?: unknown; asks?: unknown } } | null)?.order_book;
  if (!book) return null;
  const read = (row: Record<string, unknown>) => level(row.price, row.size);
  return { bids: levels(book.bids, read), asks: levels(book.asks, read) };
}

/** Lighter `trade` messages: when the maker is the ask, the taker bought. */
export function readLighterTrades(message: unknown): TapeTrade[] {
  const trades = (message as { trades?: unknown } | null)?.trades;
  return (Array.isArray(trades) ? trades : []).flatMap((row: Record<string, unknown>) => {
    const parsed = level(row?.price, row?.size);
    if (!parsed) return [];
    return [{ id: String(row.trade_id_str ?? row.trade_id), ...parsed, side: row.is_maker_ask ? "buy" : "sell", time: Number(row.timestamp) || 0 } as TapeTrade];
  });
}

/** Applies changed levels to a price → size map (size 0 removes the level). */
export function applyLevels(book: Map<number, number>, changes: BookLevel[]) {
  for (const change of changes) {
    if (change.size === 0) book.delete(change.price);
    else book.set(change.price, change.size);
  }
  return book;
}

export function sortedSide(book: Map<number, number>, side: "bids" | "asks"): BookLevel[] {
  const rows = [...book].map(([price, size]) => ({ price, size }));
  return rows.sort((a, b) => (side === "bids" ? b.price - a.price : a.price - b.price));
}

/** Groups levels into buckets of `tick` (bids round down, asks round up), best price first. */
export function groupLevels(rows: BookLevel[], tick: number, side: "bids" | "asks"): BookLevel[] {
  if (!(tick > 0)) return rows;
  const buckets = new Map<number, number>();
  for (const row of rows) {
    const steps = row.price / tick;
    // Snap away float noise (86021.0 / 0.1 = 860209.9999…) before rounding.
    const snapped = Math.abs(steps - Math.round(steps)) < 1e-9 ? Math.round(steps) : steps;
    const bucket = Number(((side === "bids" ? Math.floor(snapped) : Math.ceil(snapped)) * tick).toPrecision(12));
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + row.size);
  }
  return sortedSide(buckets, side);
}

/** Levels with a running total from the best price outward, for depth bars. */
export function withTotals(rows: BookLevel[]) {
  let total = 0;
  return rows.map((row) => {
    total += row.size;
    return { ...row, total };
  });
}

export function spreadOf(book: BookSide) {
  const bid = book.bids[0]?.price;
  const ask = book.asks[0]?.price;
  if (!bid || !ask) return null;
  return { value: ask - bid, pct: ((ask - bid) / ((ask + bid) / 2)) * 100, mid: (ask + bid) / 2 };
}

/** Grouping steps offered for a price: the smallest sensible tick, then ×10 and ×100 of it. */
export function tickOptions(price: number | undefined) {
  if (!price || !(price > 0)) return [];
  const base = 10 ** (Math.floor(Math.log10(price)) - 4);
  return [base, base * 10, base * 100].map((value) => Number(value.toPrecision(1)));
}
