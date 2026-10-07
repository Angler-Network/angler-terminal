import { describe, expect, it } from "vitest";
import search from "./fixtures/dexscreener-search-brett.json";
import tokens from "./fixtures/dexscreener-tokens-base.json";
import { readDexMarkets, readDexSearch } from "./dexscreener";
import { fromUniswapToken } from "./listings";

const WETH = "0x4200000000000000000000000000000000000006";

describe("DexScreener", () => {
  it("reads market numbers per token", () => {
    const markets = readDexMarkets(tokens);
    const weth = markets.get(WETH.toLowerCase())!;
    expect(weth.price).toBeGreaterThan(100);
    expect(weth.volume24h).toBeGreaterThan(0);
    expect(weth.liquidity).toBeGreaterThan(0);
  });

  it("sums volume and takes the price from the deepest pair", () => {
    const pair = (liquidity: number, price: string, volume: number) => ({ baseToken: { address: WETH }, liquidity: { usd: liquidity }, priceUsd: price, volume: { h24: volume } });
    const market = readDexMarkets([pair(10, "1", 5), pair(100, "2", 7)]).get(WETH.toLowerCase())!;
    expect(market).toMatchObject({ price: 2, volume24h: 12, liquidity: 110 });
  });

  it("keeps search hits on the swap chains that have a Uniswap pool", () => {
    const listings = readDexSearch(search);
    expect(listings.length).toBeGreaterThan(0);
    for (const listing of listings) {
      expect([1, 8453, 42161]).toContain(listing.chainId);
      expect(listing.verified).toBe(false);
      expect(listing.venue).toBe("uniswap");
    }
    // Solana and BSC pairs are left out; BRETT on Base has Uniswap pools.
    expect(listings.some((listing) => listing.chainId === 8453 && listing.symbol === "BRETT")).toBe(true);
    expect(new Set(listings.map((listing) => listing.id)).size).toBe(listings.length);
  });
});

describe("Uniswap token list entries", () => {
  const entry = { name: "Wrapped Ether", address: WETH, chainId: 8453, symbol: "WETH", decimals: 18, logoURI: "https://x/weth.png" };

  it("lists verified tokens, and liquid ones as verified", () => {
    expect(fromUniswapToken({ ...entry, extensions: { safetyInfo: { safetyLevel: "verified" } } })).toMatchObject({
      id: `uniswap:8453:${WETH}`,
      venue: "uniswap",
      chainId: 8453,
      decimals: 18,
      verified: true,
    });
    expect(fromUniswapToken({ ...entry, extensions: { safetyInfo: { safetyLevel: "info" } } }, { liquidity: 1_000_000 })?.verified).toBe(true);
    expect(fromUniswapToken({ ...entry, extensions: { safetyInfo: { safetyLevel: "info" } } }, { liquidity: 1_000 })?.verified).toBe(false);
  });

  it("drops blocked tokens and marks taxed ones unverified", () => {
    expect(fromUniswapToken({ ...entry, extensions: { safetyInfo: { safetyLevel: "blocked" } } })).toBeNull();
    expect(fromUniswapToken({ ...entry, extensions: { safetyInfo: { safetyLevel: "verified", sellFee: 5 } } })?.verified).toBe(false);
    expect(fromUniswapToken({ ...entry, address: "nope" })).toBeNull();
    expect(fromUniswapToken({ ...entry, symbol: "ETH", address: "0x0000000000000000000000000000000000000000" })?.verified).toBe(true);
  });

  it("marks dollar tokens", () => {
    expect(fromUniswapToken({ ...entry, symbol: "USDC" })?.stable).toBe(true);
    expect(fromUniswapToken(entry)?.stable).toBeUndefined();
  });
});
