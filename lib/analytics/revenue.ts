import type { StatsTotals } from "./trades";

/**
 * Platform revenue for the admin panel, from the trade analytics (our fee on every trade the terminal placed, as
 * estimated when it was recorded). Pure, unit-tested.
 */

export interface RevenueSummary {
  fee: number;
  usd: number;
  trades: number;
}

export interface RevenueReport {
  year: number;
  allTime: RevenueSummary & { byVenue: Record<string, RevenueSummary> };
  last30: RevenueSummary;
  last7: RevenueSummary;
  /** January first; months after today are zero. */
  months: Array<{ month: string } & RevenueSummary>;
}

/** Revenue history starts with the analytics. */
export const FIRST_REVENUE_YEAR = 2026;

const summary = (totals: Pick<StatsTotals, "fee" | "usd" | "trades">): RevenueSummary => ({ fee: totals.fee, usd: totals.usd, trades: totals.trades });

function sum(days: Array<Pick<StatsTotals, "fee" | "usd" | "trades">>): RevenueSummary {
  return days.reduce((total, day) => ({ fee: total.fee + day.fee, usd: total.usd + day.usd, trades: total.trades + day.trades }), { fee: 0, usd: 0, trades: 0 });
}

/** Every UTC day of `year`, up to `today` ("YYYY-MM-DD") when the year is the current one. */
export function yearDates(year: number, today: string) {
  const dates: string[] = [];
  for (let time = Date.UTC(year, 0, 1); time < Date.UTC(year + 1, 0, 1); time += 86_400_000) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (date > today) break;
    dates.push(date);
  }
  return dates;
}

/** `recent` is the last 30 days (oldest first), `yearDays` the chosen year's days. */
export function revenueReport(year: number, total: StatsTotals, recent: Array<{ date: string } & StatsTotals>, yearDays: Array<{ date: string } & StatsTotals>): RevenueReport {
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    return { month, ...sum(yearDays.filter((day) => day.date.startsWith(month))) };
  });
  const byVenue = Object.fromEntries(Object.entries(total.byVenue).map(([venue, totals]) => [venue, summary(totals!)]));
  return { year, allTime: { ...summary(total), byVenue }, last30: sum(recent.slice(-30)), last7: sum(recent.slice(-7)), months };
}
