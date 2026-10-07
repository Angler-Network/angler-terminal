import { describe, expect, it } from "vitest";
import { assetSymbolOf, fromArcusToken, fromJupRecord, mergeListings, pickSpotListing, representsAsset, type SpotListing } from "./listings";

const listing = (symbol: string, name: string, liquidity?: number, extra: Partial<SpotListing> = {}): SpotListing => ({
  id: `jupiter:${symbol}`,
  venue: "jupiter",
  address: symbol,
  symbol,
  name,
  category: "crypto",
  verified: true,
  liquidity,
  ...extra,
});

describe("fromJupRecord", () => {
  it("reads price, 24h stats and the stock tag", () => {
    const parsed = fromJupRecord({
      id: "mint1",
      symbol: "NVDAx",
      name: "NVIDIA xStock",
      usdPrice: 240.5,
      liquidity: 1_000_000,
      mcap: 5e9,
      tags: ["stocks", "verified"],
      stats24h: { priceChange: 1.2, buyVolume: 300, sellVolume: 200 },
    });
    expect(parsed).toMatchObject({ id: "jupiter:mint1", category: "stock", verified: true, price: 240.5, change24h: 1.2, volume24h: 500 });
  });

  it("drops records without a mint or symbol", () => {
    expect(fromJupRecord({ id: "", symbol: "X" })).toBeNull();
    expect(fromJupRecord({ id: "mint", symbol: "" })).toBeNull();
  });
});

describe("fromArcusToken", () => {
  it("keeps real-world assets with an indicative quote", () => {
    expect(fromArcusToken({ address: "0x1", symbol: "NVDA", name: "NVIDIA", category: "stock" }, { price: 240, changePct: 0.5 })).toMatchObject({
      id: "arcus:0x1",
      category: "stock",
      price: 240,
      change24h: 0.5,
    });
    expect(fromArcusToken({ address: "0x2", symbol: "MEME", name: "Meme", category: "meme" })).toBeNull();
  });
});

describe("representsAsset", () => {
  it("matches the symbol, wrapped versions and tokenized stocks", () => {
    expect(representsAsset(listing("SOL", "Wrapped SOL"), "SOL")).toBe(true);
    expect(representsAsset(listing("cbBTC", "Coinbase Wrapped BTC"), "BTC")).toBe(true);
    expect(representsAsset(listing("WBTC", "Wrapped BTC (Portal)"), "BTC")).toBe(true);
    expect(representsAsset(listing("WETH", "Wrapped Ether (Wormhole)"), "ETH")).toBe(true);
    expect(representsAsset(listing("NVDAx", "NVIDIA xStock", 1, { category: "stock" }), "NVDA")).toBe(true);
    expect(representsAsset(listing("$WIF", "dogwifhat"), "WIF")).toBe(true);
  });

  it("keeps unrelated tickers out", () => {
    expect(representsAsset(listing("TON", "Toncoin"), "ON")).toBe(false);
    expect(representsAsset(listing("JITOSOL", "Jito Staked SOL"), "SOL")).toBe(false);
    expect(representsAsset(listing("BTCX", "Some token"), "BTC")).toBe(false);
    // Real Jupiter results for "BTC": derivatives and scam tickers never stand for BTC.
    expect(representsAsset(listing("WBTC", "Wrapped Leveraged BTC"), "BTC")).toBe(false);
    expect(representsAsset(listing("LBTC", "Lombard Staked BTC"), "BTC")).toBe(false);
    expect(representsAsset(listing("ZBTC", "zBTC"), "BTC")).toBe(false);
  });
});

describe("pickSpotListing", () => {
  it("ignores unverified tokens even when they copy the ticker exactly", () => {
    // Jupiter's search for "BTC" returns a dozen unverified "BTC" tokens with millions in liquidity.
    const scams = [listing("BTC", "Big Coin", 2_500_000, { verified: false }), listing("BTC", "Burn The Coin", 2_506_522, { verified: false })];
    expect(pickSpotListing([...scams, listing("WBTC", "Wrapped BTC (Portal)", 39_716_659), listing("cbBTC", "Coinbase Wrapped BTC", 29_351_449)], "BTC")?.symbol).toBe("WBTC");
    expect(pickSpotListing(scams, "BTC")).toBeNull();
  });

  it("picks the most liquid verified token for the asset, whatever its ticker", () => {
    const listings = [listing("WBTC", "Wrapped BTC (Portal)", 2_000_000), listing("cbBTC", "Coinbase Wrapped BTC", 30_000_000), listing("BTC", "Fake BTC", 99e9, { verified: false })];
    expect(pickSpotListing(listings, "BTC")?.symbol).toBe("cbBTC");
    // Tomorrow another wrapper is deeper: it wins without a code change.
    expect(pickSpotListing([...listings, listing("zBTC", "Wrapped BTC (Zeus)", 90_000_000)], "BTC")?.symbol).toBe("zBTC");
  });

  it("filters by venue and returns null when nothing lists the asset", () => {
    const arcus = { ...listing("NVDA", "NVIDIA", undefined, { category: "stock" }), id: "arcus:0x1", venue: "arcus" as const };
    expect(pickSpotListing([arcus], "NVDA", "arcus")?.id).toBe("arcus:0x1");
    expect(pickSpotListing([arcus], "NVDA", "jupiter")).toBeNull();
    expect(pickSpotListing([], "DOGE")).toBeNull();
  });
});

describe("mergeListings", () => {
  it("dedupes by id, keeps known fields and sorts by volume", () => {
    const merged = mergeListings(
      [listing("A", "A", 5, { volume24h: 10 })],
      [listing("A", "A", undefined, { price: 2, volume24h: undefined }), listing("B", "B", 1, { volume24h: 50 })],
    );
    expect(merged.map((entry) => entry.symbol)).toEqual(["B", "A"]);
    expect(merged[1]).toMatchObject({ liquidity: 5, price: 2, volume24h: 10 });
  });
});

describe("real Jupiter search for BTC", () => {
  it("resolves BTC to the most liquid verified wrapper, never a scam ticker", async () => {
    const records = (await import("./fixtures/jup-search-btc.json")).default;
    const { pickVerifiedToken } = await import("@/lib/venues/jupiter/tokens");
    // What /api/jup/token does: no verified token is called "BTC", so the asset rule decides.
    expect(pickVerifiedToken(records, { symbol: "BTC" })).toBeNull();
    const picked = pickSpotListing(records.flatMap((record) => fromJupRecord(record) ?? []), "BTC", "jupiter");
    expect(picked).toMatchObject({ symbol: "WBTC", name: "Wrapped BTC (Portal)", verified: true });
  });
});

describe("assetSymbolOf", () => {
  it("maps tokens to the asset they trade as", () => {
    expect(assetSymbolOf(listing("WBTC", "Wrapped BTC (Portal)"))).toBe("BTC");
    expect(assetSymbolOf(listing("cbBTC", "Coinbase Wrapped BTC"))).toBe("BTC");
    expect(assetSymbolOf(listing("WETH", "Wrapped Ether (Wormhole)"))).toBe("ETH");
    expect(assetSymbolOf(listing("NVDAx", "NVIDIA xStock", 1, { category: "stock" }))).toBe("NVDA");
  });

  it("keeps a token's own ticker when it isn't a wrapper", () => {
    expect(assetSymbolOf(listing("$WIF", "dogwifhat"))).toBe("WIF");
    expect(assetSymbolOf(listing("TRUMP", "OFFICIAL TRUMP"))).toBe("TRUMP");
    expect(assetSymbolOf(listing("SOL", "Wrapped SOL"))).toBe("SOL");
    expect(assetSymbolOf(listing("LBTC", "Lombard Staked BTC"))).toBe("LBTC");
    expect(assetSymbolOf(listing("🦅EAGLE", "Eagle"))).toBeNull();
  });
});
