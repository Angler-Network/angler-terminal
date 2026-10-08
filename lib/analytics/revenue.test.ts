import { describe, expect, it } from "vitest";
import { readTotals } from "./trades";
import { revenueReport, yearDates } from "./revenue";

const day = (date: string, fee: number) => ({ date, ...readTotals({ fee, usd: fee * 1000, trades: 1 }) });

describe("revenue report", () => {
  it("lists a year's days up to today and sums months and recent windows", () => {
    expect(yearDates(2026, "2026-01-03")).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(yearDates(2025, "2026-10-08")).toHaveLength(365);

    const recent = Array.from({ length: 30 }, (_, index) => day(`2026-10-${String(index + 1).padStart(2, "0")}`, index < 23 ? 1 : 2));
    const report = revenueReport(2026, readTotals({ fee: 500, usd: 1, trades: 9, "fee:hyperliquid": 400, "usd:hyperliquid": 1, "trades:hyperliquid": 5 }), recent, [day("2026-02-10", 5), day("2026-02-11", 7), ...recent]);
    expect(report.last7.fee).toBe(14);
    expect(report.last30.fee).toBe(37);
    expect(report.months[1]).toMatchObject({ month: "2026-02", fee: 12 });
    expect(report.months[9].fee).toBe(37);
    expect(report.months[11].fee).toBe(0);
    expect(report.allTime.fee).toBe(500);
    expect(report.allTime.byVenue.hyperliquid?.fee).toBe(400);
  });
});
