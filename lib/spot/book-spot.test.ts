import { describe, expect, it } from "vitest";
import { assetSymbolOf } from "./listings";
import {
  bookSpotListing,
  bookSpotRef,
  hlSpotAsset,
  hlSpotCoin,
  isBookSpotRef,
  parseBookSpotRef,
  pickBookSpotListing,
  readHlSpotMarkets,
  readLighterSpotMarkets,
} from "./book-spot";

// Shaped like Hyperliquid's `spotMetaAndAssetCtxs`: token indexes and context order don't follow list positions.
const hlBody = [
  {
    tokens: [
      { name: "USDC", index: 0, szDecimals: 8 },
      { name: "PURR", index: 1, szDecimals: 0, fullName: null },
      { name: "UBTC", index: 197, szDecimals: 5, fullName: "Unit Bitcoin" },
      { name: "HYPE", index: 150, szDecimals: 2, fullName: "Hyperliquid" },
      { name: "USDT0", index: 268, szDecimals: 2, fullName: "USDT0" },
      { name: "DEAD", index: 9, szDecimals: 0 },
    ],
    universe: [
      { name: "PURR/USDC", index: 0, tokens: [1, 0], isCanonical: true },
      { name: "@107", index: 107, tokens: [150, 0], isCanonical: false },
      { name: "@142", index: 142, tokens: [197, 0], isCanonical: false },
      { name: "@207", index: 207, tokens: [150, 268], isCanonical: false },
      { name: "@5", index: 5, tokens: [9, 0], isCanonical: false },
    ],
  },
  [
    { coin: "@142", midPx: "83237.5", prevDayPx: "80000", dayNtlVlm: "34768047" },
    { coin: "PURR/USDC", midPx: "0.12412", prevDayPx: "0.12", dayNtlVlm: "2520185" },
    { coin: "@207", midPx: "87.51", dayNtlVlm: "51378" },
    { coin: "@107", midPx: null, markPx: "87.45", prevDayPx: "90", dayNtlVlm: "66704849" },
    { coin: "@5", midPx: "0.68", dayNtlVlm: "0.0" },
  ],
];

describe("book spot refs", () => {
  it("round-trips venue and id", () => {
    expect(bookSpotRef("hyperliquid", 107)).toBe("book:hyperliquid:107");
    expect(parseBookSpotRef("book:lighter:2048")).toEqual({ venue: "lighter", id: 2048 });
    expect(isBookSpotRef("book:hyperliquid:0")).toBe(true);
  });

  it("names Hyperliquid pairs like the API", () => {
    expect(hlSpotCoin(0)).toBe("PURR/USDC");
    expect(hlSpotCoin(107)).toBe("@107");
  });

  it("rejects anything else", () => {
    expect(parseBookSpotRef("book:uniswap:1")).toBeNull();
    expect(parseBookSpotRef("evm:8453:0xabc")).toBeNull();
    expect(isBookSpotRef("So11111111111111111111111111111111111111112")).toBe(false);
    expect(isBookSpotRef(undefined)).toBe(false);
  });
});

describe("hlSpotAsset", () => {
  it("strips Unit's U from bridged assets only", () => {
    expect(hlSpotAsset("UBTC", "Unit Bitcoin")).toBe("BTC");
    expect(hlSpotAsset("UETH", "Unit Ethereum")).toBe("ETH");
    expect(hlSpotAsset("USDT0", "USDT0")).toBe("USDT0");
    expect(hlSpotAsset("UNI", null)).toBe("UNI");
  });
});

describe("readHlSpotMarkets", () => {
  const markets = readHlSpotMarkets(hlBody, 1_000);

  it("keeps USDC pairs with volume and a price, most traded first", () => {
    expect(markets.map((market) => market.coin)).toEqual(["@107", "@142", "PURR/USDC"]);
  });

  it("matches contexts by coin and tokens by index", () => {
    const btc = markets.find((market) => market.coin === "@142")!;
    expect(btc).toMatchObject({ base: "UBTC", asset: "BTC", name: "Unit Bitcoin", assetId: 10_142, szDecimals: 5, baseToken: 197, price: 83237.5 });
    expect(btc.change24h).toBeCloseTo(4.046875, 6);
  });

  it("falls back to the mark price", () => {
    expect(markets[0]).toMatchObject({ base: "HYPE", price: 87.45, assetId: 10_107 });
  });

  it("returns nothing for a malformed body", () => {
    expect(readHlSpotMarkets(null, 0)).toEqual([]);
    expect(readHlSpotMarkets([{}, {}], 0)).toEqual([]);
  });
});

describe("readLighterSpotMarkets", () => {
  const body = {
    spot_order_book_details: [
      {
        symbol: "ETH/USDC",
        market_id: 2048,
        market_type: "spot",
        base_asset_id: 1,
        quote_asset_id: 3,
        status: "active",
        taker_fee: "0.0000",
        min_base_amount: "0.0050",
        min_quote_amount: "10.000000",
        size_decimals: 4,
        price_decimals: 2,
        last_trade_price: 2566.27,
        daily_price_change: -4.82,
        daily_quote_token_volume: 1107920.24,
      },
      { symbol: "rhSPY/USDC", market_id: 2057, base_asset_id: 9, quote_asset_id: 3, status: "active", size_decimals: 3, price_decimals: 2, last_trade_price: 0 },
      { symbol: "OLD/USDC", market_id: 2059, base_asset_id: 10, quote_asset_id: 3, status: "inactive", size_decimals: 2, price_decimals: 2 },
      { symbol: "ETH/LIT", market_id: 2060, base_asset_id: 1, quote_asset_id: 2, status: "active", size_decimals: 2, price_decimals: 2 },
    ],
  };

  it("reads active USDC markets with their decimals and minimums", () => {
    const [eth, spy, ...rest] = readLighterSpotMarkets(body);
    expect(rest).toEqual([]);
    expect(eth).toMatchObject({
      venue: "lighter",
      id: 2048,
      assetId: 2048,
      base: "ETH",
      asset: "ETH",
      szDecimals: 4,
      priceDecimals: 2,
      baseToken: 1,
      quoteToken: 3,
      minBaseAmount: 0.005,
      minQuoteAmount: 10,
      takerFee: 0,
      price: 2566.27,
      change24h: -4.82,
      category: "crypto",
    });
    expect(spy).toMatchObject({ asset: "SPY", category: "index", price: undefined });
  });
});

describe("bookSpotListing", () => {
  it("lists a market as a spot pair that trades as its asset", () => {
    const [market] = readHlSpotMarkets(hlBody, 1_000).filter((entry) => entry.coin === "@142");
    const listing = bookSpotListing(market);
    expect(listing).toMatchObject({ id: "hyperliquid:142", venue: "hyperliquid", address: "book:hyperliquid:142", symbol: "UBTC", verified: true });
    expect(assetSymbolOf(listing)).toBe("BTC");
    expect(listing.stable).toBeUndefined();
  });

  it("marks dollar tokens", () => {
    const usdt0 = readHlSpotMarkets(hlBody, 0).find((entry) => entry.base === "USDT0");
    expect(usdt0).toBeUndefined(); // not a USDC pair
    const [usdh] = readLighterSpotMarkets({ spot_order_book_details: [{ symbol: "USDH/USDC", market_id: 1, base_asset_id: 5, quote_asset_id: 3, size_decimals: 2, price_decimals: 4 }] });
    expect(bookSpotListing(usdh).stable).toBe(true);
  });
});

describe("pickBookSpotListing", () => {
  const listings = [
    { id: "hyperliquid:151", venue: "hyperliquid" as const, address: "book:hyperliquid:151", symbol: "UETH", name: "Unit Ethereum", asset: "ETH", category: "crypto" as const, verified: true, volume24h: 28_000_000 },
    { id: "lighter:2048", venue: "lighter" as const, address: "book:lighter:2048", symbol: "ETH", name: "ETH", asset: "ETH", category: "crypto" as const, verified: true, volume24h: 1_100_000 },
    { id: "jupiter:x", venue: "jupiter" as const, address: "x", symbol: "ETH", name: "Ether", category: "crypto" as const, verified: true, volume24h: 90_000_000 },
  ];

  it("takes the most traded enabled book market for the asset", () => {
    expect(pickBookSpotListing(listings, "ETH", { hyperliquid: true, lighter: true })?.id).toBe("hyperliquid:151");
    expect(pickBookSpotListing(listings, "ETH", { hyperliquid: false, lighter: true })?.id).toBe("lighter:2048");
  });

  it("is null when no book venue lists it", () => {
    expect(pickBookSpotListing(listings, "SOL", { hyperliquid: true, lighter: true })).toBeNull();
    expect(pickBookSpotListing(listings, "ETH", { hyperliquid: false, lighter: false })).toBeNull();
  });
});
