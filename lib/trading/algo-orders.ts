import type { OrderSide, PerpVenueId } from "@/lib/venues/types";

/**
 * Scale and TWAP orders, done by the terminal itself so every order carries our builder / integrator fee and earns
 * points (Hyperliquid's own TWAP action has no builder field). Pure: the order panel plans with it and the TWAP
 * runner (`use-twap-runner.ts`) steps jobs through it.
 * - Scale: `count` limit orders spread evenly from one price to another, sized evenly or growing toward either end.
 * - TWAP: market slices every `intervalMs` until the size is done; the runner needs the tab open.
 */

export const MAX_SCALE_ORDERS = 20;
export const TWAP_MIN_MINUTES = 5;
export const TWAP_MAX_MINUTES = 24 * 60;
/** Default gap between slices; fewer slices when each one would fall under the venue's minimum order. */
export const TWAP_INTERVAL_SEC = 30;
/** A job stops after this many failed slices in a row (no margin, market closed, position gone). */
export const TWAP_MAX_FAILURES = 3;
/** Random timing moves each slice up to this share of the interval either way. */
export const TWAP_JITTER = 0.2;

export type ScaleDistribution = "even" | "up" | "down";

export interface ScaleLeg {
  price: number;
  size: number;
}

function floorTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.floor(value * factor + 1e-9) / factor;
}

/**
 * Splits `totalSize` (base units) into `count` limit orders from `from` to `to` (both included). "up" makes the orders
 * grow toward `to`, "down" toward `from`. Sizes are rounded down to the lot, so the legs can add up to a hair less.
 */
export function scaleLadder(input: {
  totalSize: number;
  from: number;
  to: number;
  count: number;
  distribution: ScaleDistribution;
  szDecimals: number;
  minUsd: number;
}): { legs: ScaleLeg[]; error: string | null } {
  const { totalSize, from, to, distribution, szDecimals, minUsd } = input;
  const count = Math.round(input.count);
  if (!(from > 0) || !(to > 0)) return { legs: [], error: "Enter both prices." };
  if (from === to) return { legs: [], error: "The two prices must differ." };
  if (!(count >= 2) || count > MAX_SCALE_ORDERS) return { legs: [], error: `Use 2 to ${MAX_SCALE_ORDERS} orders.` };
  if (!(totalSize > 0)) return { legs: [], error: null };
  const weights = Array.from({ length: count }, (_, index) => (distribution === "even" ? 1 : distribution === "up" ? index + 1 : count - index));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const step = (to - from) / (count - 1);
  const legs = weights.map((weight, index) => ({ price: from + step * index, size: floorTo((totalSize * weight) / weightSum, szDecimals) }));
  const smallest = legs.reduce((min, leg) => Math.min(min, leg.size * leg.price), Infinity);
  if (legs.some((leg) => leg.size <= 0) || smallest < minUsd) {
    return { legs, error: `Each order must be at least $${Math.ceil(minUsd)}: use fewer orders or a larger size.` };
  }
  return { legs, error: null };
}

/** Size-weighted average price of the ladder. */
export function ladderAverage(legs: ScaleLeg[]) {
  const size = legs.reduce((sum, leg) => sum + leg.size, 0);
  return size > 0 ? legs.reduce((sum, leg) => sum + leg.price * leg.size, 0) / size : 0;
}

/** Legs that would fill at once instead of resting: buys above the mid, sells below it. */
export function crossingLegs(legs: ScaleLeg[], side: OrderSide, mid: number | undefined) {
  if (!mid) return 0;
  return legs.filter((leg) => (side === "buy" ? leg.price > mid : leg.price < mid)).length;
}

/** How a TWAP of `totalUsd` over `minutes` is cut: as many slices as the interval allows, each above the minimum. */
export function twapPlan(input: { totalUsd: number; minutes: number; minUsd: number; intervalSec?: number }): {
  slices: number;
  intervalMs: number;
  sliceUsd: number;
  error: string | null;
} {
  const { totalUsd, minutes, minUsd } = input;
  const intervalSec = input.intervalSec ?? TWAP_INTERVAL_SEC;
  if (!(minutes >= TWAP_MIN_MINUTES) || minutes > TWAP_MAX_MINUTES) {
    return { slices: 0, intervalMs: 0, sliceUsd: 0, error: `Run it for ${TWAP_MIN_MINUTES} minutes to 24 hours.` };
  }
  if (!(totalUsd > 0)) return { slices: 0, intervalMs: 0, sliceUsd: 0, error: null };
  const bySchedule = Math.max(1, Math.floor((minutes * 60) / intervalSec));
  const bySize = minUsd > 0 ? Math.floor(totalUsd / minUsd) : bySchedule;
  const slices = Math.min(bySchedule, bySize);
  if (slices < 2) return { slices: 0, intervalMs: 0, sliceUsd: 0, error: `A TWAP needs at least $${Math.ceil(minUsd * 2)} here (two slices of the venue minimum).` };
  return { slices, intervalMs: Math.round((minutes * 60_000) / slices), sliceUsd: totalUsd / slices, error: null };
}

export type TwapStatus = "running" | "paused" | "done" | "canceled" | "failed";

export interface TwapJob {
  id: string;
  venue: PerpVenueId;
  /** Terminal symbol, resolved to the venue's market before each slice. */
  symbol: string;
  side: OrderSide;
  /** Base units. */
  totalSize: number;
  szDecimals: number;
  slices: number;
  intervalMs: number;
  randomize: boolean;
  reduceOnly: boolean;
  leverage: number;
  isCross: boolean;
  createdAt: number;
  nextAt: number;
  /** Slices tried, filled or not. */
  done: number;
  filledSize: number;
  /** Sum of fill size × price, for the average price. */
  filledNotional: number;
  failures: number;
  status: TwapStatus;
  /** Why it stopped, when it failed. */
  error?: string;
}

export function remainingSize(job: TwapJob) {
  return Math.max(0, floorTo(job.totalSize - job.filledSize, job.szDecimals));
}

/** The next slice: what's left over the slices left, so a failed slice's share moves to the later ones. */
export function nextSliceSize(job: TwapJob) {
  const slicesLeft = job.slices - job.done;
  if (slicesLeft <= 0) return 0;
  const remaining = remainingSize(job);
  return slicesLeft === 1 ? remaining : Math.min(remaining, floorTo(remaining / slicesLeft, job.szDecimals));
}

export function averageFill(job: Pick<TwapJob, "filledSize" | "filledNotional">) {
  return job.filledSize > 0 ? job.filledNotional / job.filledSize : 0;
}

function nextTime(job: TwapJob, now: number, random: number) {
  const jitter = job.randomize ? 1 + TWAP_JITTER * (random * 2 - 1) : 1;
  return now + Math.round(job.intervalMs * jitter);
}

/** The job after one slice: `fill` null when the slice failed (`error` says why). */
export function afterSlice(
  job: TwapJob,
  fill: { size: number; price: number } | null,
  now: number,
  random = Math.random(),
  error?: string,
): TwapJob {
  const failures = fill ? 0 : job.failures + 1;
  const next: TwapJob = {
    ...job,
    done: job.done + 1,
    filledSize: job.filledSize + (fill?.size ?? 0),
    filledNotional: job.filledNotional + (fill ? fill.size * fill.price : 0),
    failures,
    nextAt: nextTime(job, now, random),
  };
  if (failures >= TWAP_MAX_FAILURES) return { ...next, status: "failed", error: error ?? "Three slices in a row failed." };
  // Done when every slice ran or what's left is below one lot.
  if (next.done >= next.slices || nextSliceSize(next) <= 0) return { ...next, status: "done" };
  return next;
}

/** A due slice: running and its time has come. */
export function sliceDue(job: TwapJob, now: number) {
  return job.status === "running" && now >= job.nextAt;
}

export function isActive(job: Pick<TwapJob, "status">) {
  return job.status === "running" || job.status === "paused";
}
