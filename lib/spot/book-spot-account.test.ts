import { describe, expect, it } from "vitest";
import type { BookSpotMarket } from "./book-spot";
import { readHlSpotBalances, readHlSpotOrderRows, readLighterSpotBalances } from "./book-spot-account";

const market = (venue: BookSpotMarket["venue"], id: number, base: string, baseToken: number, price: number, extra: Partial<BookSpotMarket> = {}): BookSpotMarket => ({
  venue,
  id,
  coin: venue === "hyperliquid" ? `@${id}` : `${base}/USDC`,
  base,
  asset: base,
  name: base,
  quote: "USDC",
  assetId: venue === "hyperliquid" ? 10_000 + id : id,
  szDecimals: 2,
  baseToken,
  category: "crypto",
  price,
  ...extra,
});

const hype = market("hyperliquid", 107, "HYPE", 150, 30);
const eth = market("lighter", 2048, "ETH", 1, 2500, { quoteToken: 3, priceDecimals: 2 });

describe("spot balances", () => {
  it("prices Hyperliquid tokens by their market and USDC at 1, largest first", () => {
    const state = {
      balances: [
        { coin: "USDC", token: 0, total: "100", hold: "40" },
        { coin: "HYPE", token: 150, total: "10", hold: "0" },
        { coin: "DUST", token: 999, total: "0", hold: "0" },
        { coin: "XYZ", token: 998, total: "5", hold: "0" },
      ],
    };
    const balances = readHlSpotBalances(state, [hype]);
    expect(balances.map((entry) => [entry.token, entry.usd, entry.available])).toEqual([
      ["HYPE", 300, 10],
      ["USDC", 100, 60],
      ["XYZ", null, 5],
    ]);
    expect(balances[0].market).toBe(hype);
  });

  it("names Lighter assets from the spot markets' base and quote ids", () => {
    const assets = [
      { asset_id: 3, balance: "50", locked_balance: "10" },
      { asset_id: 1, balance: "0.5", locked_balance: "0" },
      { asset_id: 7, balance: "0" },
    ];
    expect(readLighterSpotBalances(assets, [eth]).map((entry) => [entry.token, entry.usd, entry.available])).toEqual([
      ["ETH", 1250, 0.5],
      ["USDC", 50, 40],
    ]);
  });
});

describe("spot open orders", () => {
  it("keeps Hyperliquid's spot orders with their market, newest first", () => {
    const body = [
      { coin: "@107", side: "B", limitPx: "28", sz: "1", origSz: "2", oid: 5, timestamp: 10 },
      { coin: "BTC", side: "A", limitPx: "90000", sz: "1", oid: 6, timestamp: 30 },
      { coin: "@107", side: "A", limitPx: "40", sz: "3", oid: 7, timestamp: 20 },
    ];
    const rows = readHlSpotOrderRows(body, [hype]);
    expect(rows.map((row) => [row.oid, row.side, row.price, row.size, row.origSize])).toEqual([
      [7, "sell", 40, 3, 3],
      [5, "buy", 28, 1, 2],
    ]);
    expect(rows[0].market).toBe(hype);
  });
});
