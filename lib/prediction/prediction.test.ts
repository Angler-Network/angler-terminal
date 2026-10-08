import { describe, expect, it } from "vitest";
import meta from "./fixtures/hip4-outcome-meta.json";
import mids from "./fixtures/hip4-mids.json";
import events from "./fixtures/polymarket-events.json";
import { buildHip4Events, guessCategory, hip4AssetId, hip4Coin, readFields, readStamp, type Hip4Meta } from "./hip4";
import { readBook, readHistory, walkAsks } from "./market-data";
import { categoryOf, mapGammaEvent, type GammaEvent } from "./polymarket";
import { readPolymarketTrades } from "./trades";
import { formatChance } from "./types";

describe("HIP-4", () => {
  it("encodes coins and asset ids", () => {
    expect(hip4Coin(942, 1)).toBe("#9421");
    expect(hip4AssetId("#9421")).toBe(100_009_421);
    expect(hip4AssetId("BTC")).toBeNull();
    expect(readFields("perp:xyz:XYZ100|threshold:29855")).toEqual({ perp: "xyz:XYZ100", threshold: "29855" });
    expect(readStamp("20261031-2359")).toBe(Date.UTC(2026, 9, 31, 23, 59));
    expect(readStamp("soon")).toBeNull();
  });

  // Real outcomeMeta + allMids samples.
  // The samples were taken on 2026-10-07; pinning "now" keeps them current.
  const built = buildHip4Events(meta as Hip4Meta, mids, Date.UTC(2026, 9, 7, 14));

  it("drops events that ended days ago and files hand-written questions by their words", () => {
    expect(buildHip4Events(meta as Hip4Meta, mids, Date.UTC(2027, 0, 1)).length).toBeLessThan(built.length);
    expect(guessCategory("World Cup: Iran vs New Zealand")).toBe("sports");
    expect(guessCategory("May CPI year-over-year")).toBe("economy");
    expect(guessCategory("Who wins?")).toBe("other");
  });
  const find = (pattern: RegExp) => built.find((event) => pattern.test(event.title));

  it("titles questions from their templates", () => {
    const fed = find(/^Fed decision: October 2026$/);
    expect(fed?.category).toBe("economy");
    expect(fed?.markets.map((market) => market.label).slice(0, 3)).toEqual(["No change", "Cut", "Hike"]);
    const match = find(/^Arsenal vs Leeds United$/);
    expect(match?.subtitle).toBe("English Premier League · Matchday 6");
    expect(match?.markets.map((market) => market.label)).toEqual(["Arsenal", "Draw", "Leeds United"]);
    const bucket = find(/^BTC price on /);
    expect(bucket?.markets[0].label).toMatch(/^Under \$82,638$/);
  });

  it("groups standalone outcomes by asset and date, game or deadline", () => {
    const index = find(/^XYZ100 above ___ on Oct 7, 20:00 UTC\?$/);
    expect(index?.category).toBe("stocks");
    expect(index?.markets.map((market) => market.label)).toEqual(["29,855", "30,380", "30,905", "31,227"]);
    const game = find(/^Tampa Bay Buccaneers vs Dallas Cowboys$/);
    expect(game?.markets[0].outcomes.map((outcome) => outcome.label)).toEqual(["Buccaneers", "Cowboys"]);
    expect(game?.markets.some((market) => market.label === "Total points 47.5")).toBe(true);
    const ipo = find(/^IPO by Oct 31\?$/);
    expect(ipo?.markets.map((market) => market.label)).toEqual(expect.arrayContaining(["Anthropic", "OpenAI"]));
    // Every market trades two coins and reads its prices from allMids.
    expect(built.every((event) => event.markets.every((market) => market.outcomes.every((outcome) => /^#\d+$/.test(outcome.asset))))).toBe(true);
    expect(index?.markets[0].outcomes[0].price).toBeCloseTo(0.98083);
  });
});

describe("Polymarket", () => {
  it("maps Gamma events with parsed outcomes, prices and token ids", () => {
    const [nominee] = (events as GammaEvent[]).map(mapGammaEvent);
    expect(nominee?.id).toBe("pm:30829");
    expect(nominee?.category).toBe("politics");
    expect(nominee?.url).toBe("https://polymarket.com/event/democratic-presidential-nominee-2028");
    const top = nominee?.markets[0];
    expect(top?.outcomes.map((outcome) => outcome.label)).toEqual(["Yes", "No"]);
    expect(top?.outcomes[0].asset).toMatch(/^\d{70,}$/);
    expect(top?.polymarket?.negRisk).toBe(true);
    // Likeliest first.
    const prices = nominee?.markets.map((market) => market.outcomes[0].price ?? 0) ?? [];
    expect([...prices].sort((a, b) => b - a)).toEqual(prices);
  });

  it("picks categories from tags", () => {
    expect(categoryOf([{ slug: "bitcoin" }, { slug: "weekly" }])).toBe("crypto");
    expect(categoryOf([{ slug: "fed" }, { slug: "trump" }])).toBe("economy");
    expect(categoryOf([{ slug: "esports" }])).toBe("sports");
    expect(categoryOf([])).toBe("other");
  });

  it("drops closed markets and events", () => {
    expect(mapGammaEvent({ id: "1", closed: true, markets: [] })).toBeNull();
    expect(mapGammaEvent({ id: "2", title: "x", markets: [{ id: "m", closed: true }] })).toBeNull();
  });
});

describe("formatChance", () => {
  it("rounds to whole percents with open edges", () => {
    expect(formatChance(0.4321)).toBe("43%");
    expect(formatChance(0.004)).toBe("<1%");
    expect(formatChance(0.996)).toBe(">99%");
    expect(formatChance(null)).toBe("—");
  });
});

describe("market data", () => {
  it("reads both history formats oldest first without repeats", () => {
    expect(readHistory("polymarket", { history: [{ t: 20, p: 0.2 }, { t: 10, p: 0.1 }, { t: 20, p: 0.3 }, { t: "x", p: 1 }] })).toEqual([
      { t: 10, p: 0.1 },
      { t: 20, p: 0.2 },
    ]);
    expect(readHistory("hyperliquid", [{ t: 1791352800000, c: "0.47762" }])).toEqual([{ t: 1791352800, p: 0.47762 }]);
    expect(readHistory("polymarket", null)).toEqual([]);
  });

  it("reads both books best first", () => {
    // Polymarket lists levels worst first.
    const pm = readBook("polymarket", { bids: [{ price: "0.001", size: "706103" }, { price: "0.16", size: "10" }], asks: [{ price: "0.99", size: "5" }, { price: "0.17", size: "3" }] });
    expect(pm.bids[0]).toEqual({ price: 0.16, size: 10 });
    expect(pm.asks[0]).toEqual({ price: 0.17, size: 3 });
    const hl = readBook("hyperliquid", { levels: [[{ px: "0.13", sz: "146.0", n: 1 }], [{ px: "0.14", sz: "5.0", n: 1 }]] });
    expect(hl).toEqual({ bids: [{ price: 0.13, size: 146 }], asks: [{ price: 0.14, size: 5 }] });
  });

  it("walks asks for a dollar amount", () => {
    const asks = [{ price: 0.5, size: 10 }, { price: 0.6, size: 100 }];
    expect(walkAsks(asks, 5)).toEqual({ shares: 10, average: 0.5 });
    const deeper = walkAsks(asks, 11);
    expect(deeper?.shares).toBeCloseTo(20);
    expect(walkAsks(asks, 1000)).toBeNull();
  });
});

describe("Polymarket trades feed", () => {
  it("reads taker trades: dollars, side, trader name and icon", () => {
    const body = [
      {
        proxyWallet: "0xd1ed12197b7dc22dede923727e9b714024dbd7cb",
        side: "BUY",
        asset: "296",
        size: 127,
        price: 0.6,
        timestamp: 1791458603,
        title: "Bitcoin Up or Down - October 8, 7:15AM-7:30AM ET",
        icon: "https://polymarket-upload.s3.us-east-2.amazonaws.com/BTC+fullsize.png",
        outcome: "Up",
        name: "curie",
        pseudonym: "Illiterate-Counterforce",
        transactionHash: "0xe803",
      },
      { proxyWallet: "0x726fd4fd2d3f3a48fcbd54d1cecdd933d207d8e7", side: "SELL", asset: "935", size: "15", price: "0.9", timestamp: 1791458600, title: "Will Bitcoin dip to $80,000?", outcome: "No", name: "", pseudonym: "", icon: "" },
      { side: "BUY", size: 0, price: 0.5, timestamp: 1, title: "Empty" },
    ];
    const trades = readPolymarketTrades(body);
    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({ side: "buy", outcome: "Up", price: 0.6, size: 127, usd: 76.2, time: 1791458603000, trader: "curie", icon: expect.stringContaining("https://") });
    expect(trades[1]).toMatchObject({ side: "sell", usd: 13.5, trader: "0x726f…d8e7", icon: null });
  });
});
