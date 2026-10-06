/**
 * "What happened after similar news": the price move of an asset after its past important news, measured from
 * candles. Pure, unit-tested. A look back at history, not a forecast.
 */

export interface Candle {
  /** Open time, ms. */
  t: number;
  o: number;
  c: number;
}

export interface HorizonStats {
  horizonMin: number;
  /** News items whose horizon has ended and has prices. */
  count: number;
  /** Mean of |move| in percent: how much the asset typically moved. */
  avgAbsPct: number;
  medianPct: number;
  /** Share of moves that went up, 0-1. */
  upShare: number;
}

export interface NewsReaction {
  symbol: string;
  minImpact: number;
  /** Distinct news events used (after merging bursts). */
  events: number;
  horizons: HorizonStats[];
}

export const REACTION_HORIZONS_MIN = [60, 240, 1440];
/** News within this window of an earlier counted item is the same event (wire copies, follow-ups). */
export const EVENT_GAP_MS = 60 * 60_000;

/** Sorted, de-duplicated event times: items within `gapMs` of the previous kept one are merged into it. */
export function distinctEvents(times: number[], gapMs = EVENT_GAP_MS) {
  const sorted = times.filter(Number.isFinite).sort((a, b) => a - b);
  const kept: number[] = [];
  for (const time of sorted) {
    if (kept.length === 0 || time - kept[kept.length - 1] >= gapMs) kept.push(time);
  }
  return kept;
}

/**
 * Price at `time`: the open of the candle that contains it. Candles must be sorted by open time and evenly
 * spaced by `stepMs`. Null outside the candles or in a gap.
 */
export function priceAt(candles: Candle[], time: number, stepMs: number) {
  let low = 0;
  let high = candles.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const candle = candles[mid];
    if (time < candle.t) high = mid - 1;
    else if (time >= candle.t + stepMs) low = mid + 1;
    else return candle.o > 0 ? candle.o : null;
  }
  return null;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Move after each event for every horizon that has ended inside the candles. */
export function reactionStats(eventTimes: number[], candles: Candle[], stepMs: number, horizonsMin = REACTION_HORIZONS_MIN): HorizonStats[] {
  const end = candles.length ? candles[candles.length - 1].t + stepMs : 0;
  return horizonsMin.map((horizonMin) => {
    const moves = eventTimes.flatMap((time) => {
      const later = time + horizonMin * 60_000;
      if (later >= end) return [];
      const before = priceAt(candles, time, stepMs);
      const after = priceAt(candles, later, stepMs);
      return before && after ? [((after - before) / before) * 100] : [];
    });
    return {
      horizonMin,
      count: moves.length,
      avgAbsPct: moves.length ? moves.reduce((sum, move) => sum + Math.abs(move), 0) / moves.length : 0,
      medianPct: moves.length ? median(moves) : 0,
      upShare: moves.length ? moves.filter((move) => move > 0).length / moves.length : 0,
    };
  });
}

/** Hyperliquid `candleSnapshot` rows ({ t, o, c, ... } with string prices) as candles, sorted. */
export function readHlCandles(body: unknown): Candle[] {
  if (!Array.isArray(body)) return [];
  return body
    .flatMap((row: Record<string, unknown>) => {
      const t = Number(row?.t);
      const o = Number(row?.o);
      const c = Number(row?.c);
      return Number.isFinite(t) && o > 0 && c > 0 ? [{ t, o, c }] : [];
    })
    .sort((a, b) => a.t - b.t);
}

/** Impact bucket a news item is compared within: important news with important news. */
export function reactionBucket(score: number) {
  return score >= 80 ? 80 : score >= 60 ? 60 : 40;
}

/** Short label for a horizon: 60 → "1h", 1440 → "24h". */
export function horizonLabel(minutes: number) {
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}
