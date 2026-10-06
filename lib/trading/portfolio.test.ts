import { describe, expect, it } from "vitest";
import type { VenuePosition } from "@/lib/venues/types";
import { groupByVenue, summarizeVenue, totalSummary } from "./portfolio";

const position = (overrides: Partial<VenuePosition>): VenuePosition => ({
  venue: "hyperliquid",
  coin: "BTC",
  symbol: "BTC",
  dex: "",
  size: 0.1,
  entryPx: 100_000,
  positionValue: 10_000,
  unrealizedPnl: 50,
  returnOnEquity: 0.05,
  liquidationPx: 80_000,
  leverage: 10,
  leverageType: "cross",
  ...overrides,
});

describe("portfolio summary", () => {
  it("sums PnL and margin per venue and across venues", () => {
    const hl = summarizeVenue("hyperliquid", {
      accountValue: 2_000,
      withdrawable: 500,
      positions: [position({}), position({ coin: "ETH", positionValue: 3_000, leverage: 3, unrealizedPnl: -20 })],
      orders: [],
    });
    expect(hl).toMatchObject({ unrealizedPnl: 30, marginUsed: 2_000, positions: 2 });
    const lighter = summarizeVenue("lighter", { accountValue: 1_000, withdrawable: 1_000, positions: [], orders: [] });
    expect(totalSummary([hl, lighter])).toMatchObject({ accountValue: 3_000, withdrawable: 1_500, unrealizedPnl: 30, positions: 2 });
  });
});

describe("groupByVenue", () => {
  it("keeps venue and row order", () => {
    const rows = [
      { venue: "lighter" as const, id: 1 },
      { venue: "hyperliquid" as const, id: 2 },
      { venue: "lighter" as const, id: 3 },
    ];
    expect(groupByVenue(rows)).toEqual([
      { venue: "lighter", rows: [rows[0], rows[2]] },
      { venue: "hyperliquid", rows: [rows[1]] },
    ]);
    expect(groupByVenue([])).toEqual([]);
  });
});
