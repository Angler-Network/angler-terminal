import type { TwapJob, TwapStatus } from "./algo-orders";

/**
 * TWAP jobs per wallet in localStorage, so a reload or a second tab sees them. Only the tab holding the runner lock
 * (`use-twap-runner.ts`) sends slices; every tab reads and can pause or cancel. Finished jobs are kept for a day so
 * the TWAP tab can show how they went.
 */

const PREFIX = "angler:twap:";
const KEEP_FINISHED_MS = 86_400_000;
const MAX_JOBS = 30;
const STATUSES: TwapStatus[] = ["running", "paused", "done", "canceled", "failed"];

const key = (user: string) => `${PREFIX}${user.toLowerCase()}`;

function isJob(value: unknown): value is TwapJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Record<string, unknown>;
  const numbers = ["totalSize", "szDecimals", "slices", "intervalMs", "leverage", "createdAt", "nextAt", "done", "filledSize", "filledNotional", "failures"];
  return (
    typeof job.id === "string" &&
    typeof job.venue === "string" &&
    typeof job.symbol === "string" &&
    (job.side === "buy" || job.side === "sell") &&
    STATUSES.includes(job.status as TwapStatus) &&
    numbers.every((name) => typeof job[name] === "number" && Number.isFinite(job[name] as number))
  );
}

/** Valid jobs from a stored value, finished ones older than a day dropped. */
export function readTwapJobs(raw: string | null, now = Date.now()): TwapJob[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isJob)
      .filter((job) => job.status === "running" || job.status === "paused" || now - job.nextAt < KEEP_FINISHED_MS)
      .slice(-MAX_JOBS);
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();

export function loadTwapJobs(user: string): TwapJob[] {
  try {
    return readTwapJobs(window.localStorage.getItem(key(user)));
  } catch {
    return [];
  }
}

function save(user: string, jobs: TwapJob[]) {
  try {
    window.localStorage.setItem(key(user), JSON.stringify(jobs.slice(-MAX_JOBS)));
  } catch {
    // Private mode or full storage: the job still runs in memory for this tab until a reload.
  }
  listeners.forEach((listener) => listener());
}

/** Reads, changes and writes back in one go; `change` gets the latest stored list (another tab may have written). */
export function updateTwapJobs(user: string, change: (jobs: TwapJob[]) => TwapJob[]) {
  const next = change(loadTwapJobs(user));
  save(user, next);
  return next;
}

export function updateTwapJob(user: string, id: string, change: (job: TwapJob) => TwapJob) {
  return updateTwapJobs(user, (jobs) => jobs.map((job) => (job.id === id ? change(job) : job)));
}

/** Calls back on changes from this tab or another one. */
export function subscribeTwapJobs(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(PREFIX)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
