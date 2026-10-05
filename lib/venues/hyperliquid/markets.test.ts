import { describe, expect, it } from "vitest";
import { builderDexes, findMarket, marketsFromMeta, perpAssetId, splitCoin, spotAssetId } from "./markets";

describe("asset ids", () => {
  it("uses the universe index on the main dex", () => {
    expect(perpAssetId(0, 0)).toBe(0);
    expect(perpAssetId(0, 7)).toBe(7);
  });

  it("offsets HIP-3 dexs by 100000 + dexIndex * 10000", () => {
    expect(perpAssetId(1, 0)).toBe(110000);
    expect(perpAssetId(2, 5)).toBe(120005);
  });

  it("offsets spot by 10000", () => {
    expect(spotAssetId(107)).toBe(10107);
  });
});

describe("markets", () => {
  const xyzMeta = {
    universe: [
      { name: "xyz:NVDA", szDecimals: 2, maxLeverage: 10, onlyIsolated: true },
      { name: "xyz:OLD", szDecimals: 0, maxLeverage: 3, isDelisted: true },
      { name: "xyz:BTC", szDecimals: 4, maxLeverage: 5 },
    ],
  };
  const mainMeta = { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }] };
  const markets = [
    ...marketsFromMeta(0, "", mainMeta, [{ markPx: "65000", midPx: "65001" }]),
    ...marketsFromMeta(1, "xyz", xyzMeta),
  ];

  it("names HIP-3 coins dex:COIN and strips the prefix for the display symbol", () => {
    expect(splitCoin("xyz:NVDA")).toEqual({ dex: "xyz", symbol: "NVDA" });
    expect(splitCoin("BTC")).toEqual({ dex: "", symbol: "BTC" });
    const nvda = markets.find((market) => market.coin === "xyz:NVDA");
    expect(nvda).toMatchObject({ symbol: "NVDA", dex: "xyz", assetId: 110000, kind: "stock", onlyIsolated: true });
  });

  it("skips delisted assets but keeps the original index for later ones", () => {
    expect(markets.some((market) => market.coin === "xyz:OLD")).toBe(false);
    expect(markets.find((market) => market.coin === "xyz:BTC")?.assetId).toBe(110002);
  });

  it("reads prices from asset contexts", () => {
    expect(markets[0]).toMatchObject({ markPx: 65000, midPx: 65001 });
  });

  it("prefers the main dex for a bare symbol and matches coin names exactly", () => {
    expect(findMarket(markets, "btc")?.coin).toBe("BTC");
    expect(findMarket(markets, "xyz:BTC")?.coin).toBe("xyz:BTC");
    expect(findMarket(markets, "NVDA")?.coin).toBe("xyz:NVDA");
    expect(findMarket(markets, "DOGE")).toBeNull();
  });

  it("lists builder dexs with their perpDexs index", () => {
    expect(builderDexes([null, { name: "xyz" }, { name: "" }, { name: "flx" }])).toEqual([
      { name: "xyz", index: 1 },
      { name: "flx", index: 3 },
    ]);
  });
});
