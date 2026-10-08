import { describe, expect, it } from "vitest";
import { liquidationMessages, newsMessages, positionMessages, priceMessages, type PositionSnap } from "./rules";
import { DEFAULT_ALERT_SETTINGS } from "./settings";

const btc = (size: number, extra: Partial<PositionSnap> = {}): PositionSnap => ({
  venue: "hyperliquid",
  coin: "BTC",
  size,
  entryPx: 60_000,
  markPx: 61_000,
  liquidationPx: 50_000,
  unrealizedPnl: 100,
  ...extra,
});

describe("positionMessages", () => {
  it("reports opened, added, reduced, flipped and closed positions", () => {
    expect(positionMessages({}, { "hyperliquid:BTC": btc(1) })[0]).toMatch(/^🟢 Opened long 1 BTC on Hyperliquid/);
    expect(positionMessages({ k: btc(1) }, { k: btc(2) })[0]).toMatch(/Added to long BTC on Hyperliquid: 1 → 2/);
    expect(positionMessages({ k: btc(2) }, { k: btc(0.5) })[0]).toMatch(/Reduced long BTC on Hyperliquid: 2 → 0.5/);
    expect(positionMessages({ k: btc(1) }, { k: btc(-1) })[0]).toMatch(/Flipped BTC on Hyperliquid to short 1/);
    expect(positionMessages({ k: btc(-1) }, {})[0]).toMatch(/Closed short 1 BTC on Hyperliquid .*uPnL \+\$100/);
  });

  it("stays quiet when nothing changed", () => {
    expect(positionMessages({ k: btc(1) }, { k: btc(1, { markPx: 62_000 }) })).toEqual([]);
  });
});

describe("liquidationMessages", () => {
  const near = { k: btc(1, { markPx: 52_000, liquidationPx: 50_000 }) }; // 3.8% away

  it("warns once inside the distance and re-arms only well outside it", () => {
    const first = liquidationMessages(near, 5, []);
    expect(first.messages).toHaveLength(1);
    expect(first.warned).toEqual(["k"]);
    expect(liquidationMessages(near, 5, first.warned).messages).toEqual([]);
    // 6.25% away: outside 5% but under 7.5%, still armed off.
    expect(liquidationMessages({ k: btc(1, { markPx: 53_333, liquidationPx: 50_000 }) }, 5, ["k"]).warned).toEqual(["k"]);
    expect(liquidationMessages({ k: btc(1, { markPx: 60_000, liquidationPx: 50_000 }) }, 5, ["k"]).warned).toEqual([]);
  });

  it("is off without a distance", () => {
    expect(liquidationMessages(near, null, []).messages).toEqual([]);
  });
});

describe("priceMessages", () => {
  const alerts = [
    { id: "a", coin: "BTC", direction: "above" as const, price: 70_000 },
    { id: "b", coin: "ETH", direction: "below" as const, price: 2_000 },
  ];

  it("fires each alert once when the mid reaches it", () => {
    const first = priceMessages(alerts, { BTC: 70_100, ETH: 2_100 }, []);
    expect(first.messages).toHaveLength(1);
    expect(first.fired).toEqual(["a"]);
    expect(priceMessages(alerts, { BTC: 71_000, ETH: 1_900 }, first.fired).fired).toEqual(["a", "b"]);
    expect(priceMessages(alerts, { BTC: 71_000 }, ["a"]).messages).toEqual([]);
  });

  it("forgets fired ids of deleted alerts", () => {
    expect(priceMessages([], {}, ["a"]).fired).toEqual([]);
  });
});

describe("newsMessages", () => {
  const items = [
    { id: 1, title: "BTC ETF inflows", impact: 85, coins: ["BTC"] },
    { id: 2, title: "SOL outage", impact: 90, coins: ["SOL"] },
    { id: 3, title: "Minor BTC note", impact: 50, coins: ["BTC"] },
  ];

  it("matches held and listed coins at the impact threshold", () => {
    const settings = { ...DEFAULT_ALERT_SETTINGS, newsMinImpact: 80, newsCoins: ["SOL"] };
    expect(newsMessages(items, settings, ["BTC"])).toEqual(["📰 [85] BTC: BTC ETF inflows", "📰 [90] SOL: SOL outage"]);
    expect(newsMessages(items, { ...settings, newsHeld: false }, ["BTC"])).toEqual(["📰 [90] SOL: SOL outage"]);
  });

  it("is off without an impact", () => {
    expect(newsMessages(items, DEFAULT_ALERT_SETTINGS, ["BTC"])).toEqual([]);
  });
});
