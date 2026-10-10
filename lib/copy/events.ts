/**
 * What a followed wallet did between two looks at its positions. Pure: the copy runner turns events into orders and
 * the alerts tick into messages.
 */

export interface LeaderPosition {
  /** The venue's coin name ("BTC", "xyz:NVDA"). */
  coin: string;
  /** Signed base size: positive long. */
  size: number;
  entryPx: number;
  markPx: number;
}

export type LeaderEventKind = "open" | "add" | "reduce" | "close" | "flip";

export interface LeaderEvent {
  kind: LeaderEventKind;
  coin: string;
  /** Signed sizes before and after (0 when there was none / none left). */
  before: number;
  after: number;
  /** Price the change happened at, as well as the snapshots tell: entry for opens, mark otherwise. */
  price: number;
}

/** Changes smaller than this share of the position are rounding noise, not trades. */
const NOISE = 1e-9;

export function leaderEvents(previous: Record<string, LeaderPosition>, current: Record<string, LeaderPosition>): LeaderEvent[] {
  const events: LeaderEvent[] = [];
  for (const [coin, now] of Object.entries(current)) {
    const before = previous[coin];
    if (!before) {
      events.push({ kind: "open", coin, before: 0, after: now.size, price: now.entryPx || now.markPx });
    } else if (Math.sign(before.size) !== Math.sign(now.size)) {
      events.push({ kind: "flip", coin, before: before.size, after: now.size, price: now.entryPx || now.markPx });
    } else if (Math.abs(now.size) - Math.abs(before.size) > Math.abs(before.size) * NOISE) {
      // The added part's price, from how the average entry moved: (new entry × new size − old entry × old size) / added.
      const added = Math.abs(now.size) - Math.abs(before.size);
      const price = (now.entryPx * Math.abs(now.size) - before.entryPx * Math.abs(before.size)) / added;
      events.push({ kind: "add", coin, before: before.size, after: now.size, price: price > 0 ? price : now.markPx });
    } else if (Math.abs(before.size) - Math.abs(now.size) > Math.abs(before.size) * NOISE) {
      events.push({ kind: "reduce", coin, before: before.size, after: now.size, price: now.markPx });
    }
  }
  for (const [coin, before] of Object.entries(previous)) {
    if (!current[coin]) events.push({ kind: "close", coin, before: before.size, after: 0, price: before.markPx });
  }
  return events;
}

/** Display name of a venue coin ("xyz:NVDA" → "NVDA"). */
export function coinSymbol(coin: string) {
  return coin.includes(":") ? coin.split(":")[1] : coin;
}
