import { describe, expect, it } from "vitest";
import { estimateFeeUsd, filledUsd, lastDays, readServerFeeRates, readTotals, readTradeEvent, sumTotals, tradeIncrements, type TradeEvent } from "./trades";

const event = (overrides: Partial<TradeEvent> = {}): TradeEvent => ({
  venue: "hyperliquid",
  side: "buy",
  newsId: null,
  oneClick: false,
  usd: 1000,
  feeBps: 2.5,
  ...overrides,
});

describe("readTradeEvent", () => {
  it("keeps venue, side, news id, one-click, volume and fee rate, and drops anything else", () => {
    expect(readTradeEvent({ venue: "titan", side: "buy", newsId: "n-1", oneClick: true, usd: 12.345, feeBps: 2.5, wallet: "x" })).toEqual({
      venue: "titan",
      side: "buy",
      newsId: "n-1",
      oneClick: true,
      usd: 12.35,
      feeBps: 2.5,
    });
  });

  it("rejects unknown venues and sides, and drops malformed news ids", () => {
    expect(readTradeEvent({ venue: "binance", side: "buy" })).toBeNull();
    expect(readTradeEvent({ venue: "hyperliquid", side: "long" })).toBeNull();
    expect(readTradeEvent({ venue: "hyperliquid", side: "sell", newsId: "<script>" })?.newsId).toBeNull();
  });

  it("counts events from older tabs without volume, and rejects bogus amounts", () => {
    expect(readTradeEvent({ venue: "lighter", side: "sell" })).toMatchObject({ usd: 0, feeBps: null });
    expect(readTradeEvent({ venue: "lighter", side: "sell", usd: -5 })).toBeNull();
    expect(readTradeEvent({ venue: "lighter", side: "sell", usd: 1e9 })).toBeNull();
    expect(readTradeEvent({ venue: "lighter", side: "sell", usd: "100" })).toBeNull();
    expect(readTradeEvent({ venue: "lighter", side: "sell", usd: 100, feeBps: 5000 })?.feeBps).toBeNull();
  });
});

describe("estimateFeeUsd", () => {
  const rates = readServerFeeRates({
    JUP_REFERRAL_ACCOUNT: "acct",
    JUP_REFERRAL_FEE_BPS: "50",
    TITAN_FEE_WALLET: "wallet",
    TITAN_FEE_BPS: "30",
    ARCUS_BUILDER_FEE_BPS: "20",
  });

  it("uses the reported rate for perps and server config for spot, net of Jupiter's 20% cut", () => {
    expect(estimateFeeUsd(event({ venue: "hyperliquid", feeBps: 2.5 }), rates)).toBe(0.25);
    expect(estimateFeeUsd(event({ venue: "lighter", feeBps: 0 }), rates)).toBe(0);
    expect(estimateFeeUsd(event({ venue: "jupiter", feeBps: null }), rates)).toBe(4);
    expect(estimateFeeUsd(event({ venue: "titan", feeBps: 99 }), rates)).toBe(3);
  });

  it("counts no spot fee when the fee setting is incomplete", () => {
    expect(rates.arcusBps).toBe(0);
    expect(readServerFeeRates({ JUP_REFERRAL_FEE_BPS: "50" }).jupiterBps).toBe(0);
  });
});

describe("totals", () => {
  it("adds per-venue, news and one-click fields, skipping zeros", () => {
    expect(tradeIncrements(event({ newsId: "n1", oneClick: true }), 0.25)).toEqual([
      ["trades", 1],
      ["usd", 1000],
      ["fee", 0.25],
      ["trades:hyperliquid", 1],
      ["usd:hyperliquid", 1000],
      ["fee:hyperliquid", 0.25],
      ["news:trades", 1],
      ["news:usd", 1000],
      ["oneclick:trades", 1],
    ]);
    expect(tradeIncrements(event({ usd: 0 }), 0).map(([field]) => field)).toEqual(["trades", "trades:hyperliquid"]);
  });

  it("reads Redis string hashes and sums days", () => {
    const day = readTotals({ trades: "2", usd: "150.5", fee: "0.04", "trades:titan": "2", "usd:titan": "150.5", "fee:titan": "0.04" });
    expect(day).toMatchObject({ trades: 2, usd: 150.5, byVenue: { titan: { trades: 2, usd: 150.5, fee: 0.04 } } });
    expect(sumTotals([day, day, readTotals(null)])).toMatchObject({ trades: 4, usd: 301, fee: 0.08, byVenue: { titan: { trades: 4 } } });
  });

  it("lists UTC days oldest first", () => {
    expect(lastDays(new Date("2026-10-06T01:00:00Z"), 3)).toEqual(["2026-10-04", "2026-10-05", "2026-10-06"]);
  });

  it("counts filled notional only", () => {
    expect(filledUsd({ status: "filled", filledSize: 0.5, avgPx: 60000 })).toBe(30000);
    expect(filledUsd({ status: "resting" })).toBe(0);
  });
});
