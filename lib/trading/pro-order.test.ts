import { describe, expect, it } from "vitest";
import type { VenueMarket } from "@/lib/venues/types";
import { baseSize, hedgeLegs, planLegs } from "./pro-order";

const market = (overrides: Partial<VenueMarket>): VenueMarket =>
  ({ venue: "hyperliquid", symbol: "BTC", coin: "BTC", szDecimals: 3, maxLeverage: 20, midPx: 50_000, ...overrides }) as VenueMarket;

describe("pro order", () => {
  it("sizes down to the step", () => {
    expect(baseSize(100, 50_000, 3)).toBe(0.002);
    expect(baseSize(0, 50_000, 3)).toBe(0);
  });

  it("plans legs: clamps leverage, flags unlisted, unsized and too-small legs", () => {
    const markets = { hyperliquid: market({}), lighter: market({ venue: "lighter", szDecimals: 5, maxLeverage: 10 }) };
    const plans = planLegs(
      [
        { id: 1, venue: "hyperliquid", symbol: "BTC", side: "buy", usd: 100, leverage: 50 },
        { id: 2, venue: "lighter", symbol: "BTC", side: "sell", usd: 5, leverage: 3 },
        { id: 3, venue: "lighter", symbol: "DOGE", side: "buy", usd: 100, leverage: 3 },
        { id: 4, venue: "hyperliquid", symbol: "BTC", side: "buy", usd: 0, leverage: 3 },
      ],
      (venue, symbol) => (symbol === "BTC" && (venue === "hyperliquid" || venue === "lighter") ? markets[venue] : null),
      () => 10,
    );
    expect(plans.map((plan) => [plan.size, plan.leverage, plan.problem])).toEqual([
      [0.002, 20, null],
      [0.0001, 3, "Minimum is about $10"],
      [0, 1, "DOGE isn't listed on this venue"],
      [0, 3, "Enter a size"],
    ]);
  });

  it("hedges the same size on both venues", () => {
    const legs = hedgeLegs("ETH", "lighter", "hyperliquid", 250, 3);
    expect(legs.map((leg) => [leg.venue, leg.side, leg.usd])).toEqual([
      ["lighter", "buy", 250],
      ["hyperliquid", "sell", 250],
    ]);
    const plans = planLegs(legs, (venue) => market({ venue, szDecimals: venue === "lighter" ? 4 : 2, midPx: 3_000 }), () => 10, 2);
    expect(plans[0].size).toBe(plans[1].size);
    expect(plans[0].size).toBe(0.08);
  });
});
