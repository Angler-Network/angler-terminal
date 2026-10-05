import { describe, expect, it } from "vitest";
import { countTrade, createCounters, readTradeEvent } from "./trades";

describe("readTradeEvent", () => {
  it("accepts venue, side, news id and one-click flag only", () => {
    expect(readTradeEvent({ venue: "jupiter", side: "buy", newsId: "n-1", oneClick: true, wallet: "x", usd: 5 })).toEqual({
      venue: "jupiter",
      side: "buy",
      newsId: "n-1",
      oneClick: true,
    });
  });

  it("rejects unknown venues and sides, and drops malformed news ids", () => {
    expect(readTradeEvent({ venue: "binance", side: "buy" })).toBeNull();
    expect(readTradeEvent({ venue: "hyperliquid", side: "long" })).toBeNull();
    expect(readTradeEvent({ venue: "lighter", side: "sell" })?.venue).toBe("lighter");
    expect(readTradeEvent({ venue: "binance", side: "sell" })).toBeNull();
    expect(readTradeEvent({ venue: "hyperliquid", side: "sell", newsId: "<script>" })?.newsId).toBeNull();
  });
});

describe("countTrade", () => {
  it("counts per venue and per news item", () => {
    const counters = createCounters(new Date(0));
    countTrade(counters, { venue: "hyperliquid", side: "buy", newsId: "n1", oneClick: false });
    countTrade(counters, { venue: "jupiter", side: "sell", newsId: "n1", oneClick: true });
    countTrade(counters, { venue: "jupiter", side: "buy", newsId: null, oneClick: false });
    expect(counters).toMatchObject({
      total: 3,
      fromNews: 2,
      oneClick: 1,
      byVenue: { hyperliquid: 1, jupiter: 2 },
      byNews: { n1: { total: 2, byVenue: { hyperliquid: 1, jupiter: 1 } } },
    });
  });

  it("keeps a bounded number of news items", () => {
    const counters = createCounters();
    for (let index = 0; index < 510; index++) countTrade(counters, { venue: "jupiter", side: "buy", newsId: `n${index}`, oneClick: false });
    expect(Object.keys(counters.byNews)).toHaveLength(500);
    expect(counters.byNews.n0).toBeUndefined();
    expect(counters.byNews.n509).toBeDefined();
  });
});
