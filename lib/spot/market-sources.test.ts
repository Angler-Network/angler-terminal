import { describe, expect, it } from "vitest";
import gecko from "./fixtures/gecko-tokens-multi.json";
import geckoPools from "./fixtures/gecko-pools-robinhood.json";
import { readGeckoPoolTokens, readGeckoTokens } from "./gecko-tokens";
import { MARKET_MEMORY_TTL_MS, decodeMarket, encodeMarket, fillMarket, needsStats } from "./market-memory";

describe("GeckoTerminal token stats", () => {
  it("reads price, volume, liquidity and market cap by lowercase address", () => {
    const markets = readGeckoTokens(gecko);
    const weth = markets.get("0x4200000000000000000000000000000000000006")!;
    expect(weth.price).toBeCloseTo(2572.18);
    expect(weth.volume24h).toBeGreaterThan(1e8);
    expect(weth.liquidity).toBeGreaterThan(1e8);
    expect(weth.marketCap).toBeGreaterThan(1e8);
    expect(weth.icon).toMatch(/^https:/);
    // No market cap: the fully diluted value stands in; a non-URL image is dropped.
    const brett = markets.get("0x532f27101965dd16442e59d40670faf5ebb142e4")!;
    expect(brett.marketCap).toBeCloseTo(52924303.6, 0);
    expect(brett.icon).toBeUndefined();
    expect(readGeckoTokens({ errors: [{ status: "429" }] }).size).toBe(0);
  });
});

describe("market memory", () => {
  it("remembers volume and liquidity for a while", () => {
    const encoded = encodeMarket({ volume24h: 10, liquidity: 20, marketCap: 30, price: 1 }, 1_000)!;
    expect(decodeMarket(encoded, 2_000)).toEqual({ volume24h: 10, liquidity: 20, marketCap: 30 });
    expect(decodeMarket(encoded, 1_000 + MARKET_MEMORY_TTL_MS + 1)).toBeNull();
    expect(encodeMarket({ price: 1 })).toBeNull();
    expect(decodeMarket("not json")).toBeNull();
  });

  it("fills only what's missing, in order", () => {
    expect(fillMarket({ price: 1 }, { price: 2, volume24h: 5 }, { volume24h: 9, liquidity: 7 })).toEqual({ price: 1, volume24h: 5, liquidity: 7 });
    expect(fillMarket(undefined, null, { liquidity: 3 })).toEqual({ liquidity: 3 });
    expect(needsStats({ volume24h: 1, liquidity: 2 })).toBe(false);
    expect(needsStats({ volume24h: 1 })).toBe(true);
  });
});

describe("GeckoTerminal top pools", () => {
  it("lists the busiest pools' tokens once each, busiest first, in the token-list shape", () => {
    const tokens = readGeckoPoolTokens(geckoPools, 4663);
    expect(tokens.map((token) => token.symbol)).toEqual(["USDG", "WETH", "PONS", "SUSD", "NVDA"]);
    expect(tokens[2]).toMatchObject({ address: "0xa9db6d3fb987257767b7227b7df5fad099004571", chainId: 4663, decimals: 18 });
    expect(readGeckoPoolTokens({ data: [] }, 4663)).toEqual([]);
  });
});
