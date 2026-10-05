import { describe, expect, it } from "vitest";
import mainnet from "./fixtures/tokens-mainnet.json";
import testnet from "./fixtures/tokens-testnet.json";
import { findArcusToken, findQuoteToken, readArcusTokens } from "./tokens";

describe("Arcus tokens", () => {
  it("matches stocks and indices by symbol and skips memes and leveraged pTokens", () => {
    const tokens = readArcusTokens(mainnet);
    expect(findArcusToken(tokens, "nvda")).toMatchObject({ symbol: "NVDA", decimals: 18, category: "stock" });
    expect(findArcusToken(tokens, "SPY")?.category).toBe("index");
    expect(findArcusToken(tokens, "PBTC3X")).toBeNull();
    expect(tokens.some((token) => token.category === "meme")).toBe(false);
    expect(findQuoteToken(tokens, "USDG")).toMatchObject({ decimals: 6 });
  });

  it("finds the testnet stock token and the mock stablecoin", () => {
    const tokens = readArcusTokens(testnet);
    expect(findArcusToken(tokens, "TSLA")?.address).toBe("0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E");
    expect(findQuoteToken(tokens, "mUSDG")?.decimals).toBe(6);
    expect(findArcusToken(tokens, "BTC")).toBeNull();
  });

  it("ignores malformed entries", () => {
    expect(readArcusTokens({ tokens: [] })).toEqual([]);
    expect(readArcusTokens([{ symbol: "X", address: "nope", decimals: 6 }])).toEqual([]);
  });
});
