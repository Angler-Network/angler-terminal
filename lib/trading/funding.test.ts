import { describe, expect, it } from "vitest";
import { arbLegSize, bestFundingArb, dailyArbFunding, fundingApr, readFundingRates } from "./funding";

// Trimmed from the live mainnet response.
const body = {
  code: 200,
  funding_rates: [
    { market_id: 1, exchange: "binance", symbol: "BTC", rate: -1.765e-5 },
    { market_id: 1, exchange: "bybit", symbol: "BTC", rate: 9.44e-6 },
    { market_id: 1, exchange: "hyperliquid", symbol: "BTC", rate: 0.0001 },
    { market_id: 1, exchange: "lighter", symbol: "BTC", rate: 9.6e-5 },
    { market_id: 2, exchange: "okx", symbol: "BTC", rate: 1 },
  ],
};

describe("funding", () => {
  it("groups rates by symbol and venue, ignoring unknown venues", () => {
    const table = readFundingRates(body);
    expect(table.BTC).toEqual({ binance: -1.765e-5, bybit: 9.44e-6, hyperliquid: 0.0001, lighter: 9.6e-5 });
  });

  it("annualizes 8-hour rates and finds the tradable arb", () => {
    expect(fundingApr(0.0001)).toBeCloseTo(10.95);
    const arb = bestFundingArb(readFundingRates(body).BTC)!;
    expect(arb).toMatchObject({ longVenue: "lighter", shortVenue: "hyperliquid" });
    expect(arb.apr).toBeCloseTo(fundingApr(0.0001 - 9.6e-5));
    expect(bestFundingArb({ hyperliquid: 0.0001 })).toBeNull();
  });
});

describe("arb sizing", () => {
  it("uses the coarser size step and estimates daily funding", () => {
    expect(arbLegSize(1000, 2700, [4, 2])).toBe(0.37);
    expect(arbLegSize(1000, 2700, [5])).toBe(0.37037);
    expect(arbLegSize(0, 2700, [4])).toBe(0);
    expect(dailyArbFunding(3650, { apr: 10 })).toBeCloseTo(1);
  });
});
