import { describe, expect, it } from "vitest";
import price from "./fixtures/price-mainnet.json";
import { arcusErrorMessage, arcusPriceImpactPct, indicativeTokenPrice, pickArcusQuote, readReferencePrice } from "./quote";

describe("Arcus quotes", () => {
  it("measures price impact against the router's reference price", () => {
    const quote = pickArcusQuote<{ venue: string; buyAmount: string; sellAmount: string }>(price);
    expect(quote?.venue).toBe("arcus");
    const impact = arcusPriceImpactPct(
      { sellAmount: BigInt(quote!.sellAmount), buyAmount: BigInt(quote!.buyAmount) },
      { sell: 6, buy: 18 },
      readReferencePrice(price),
    );
    expect(impact).toBeGreaterThan(0);
    expect(impact).toBeLessThan(1);
  });

  it("skips the impact check without a reference price", () => {
    expect(readReferencePrice({ referencePrice: null })).toBeNull();
    expect(arcusPriceImpactPct({ sellAmount: 1n, buyAmount: 1n }, { sell: 6, buy: 18 }, null)).toBeNull();
  });

  it("ignores other venues and maps error codes", () => {
    expect(pickArcusQuote({ all: [{ venue: "rialto" }] })).toBeNull();
    expect(arcusErrorMessage("TRADE_NOTIONAL_BELOW_MINIMUM", "x")).toContain("$5");
    expect(arcusErrorMessage("SOMETHING_NEW", "Fallback")).toBe("Fallback");
  });

  it("prices a token from what $100 buys", () => {
    // 0.25 tokens (18 decimals) for $100 → $400 each.
    expect(indicativeTokenPrice(100, "250000000000000000", 18)).toBe(400);
    expect(indicativeTokenPrice(100, "0", 18)).toBeNull();
    expect(indicativeTokenPrice(100, undefined, 18)).toBeNull();
    expect(indicativeTokenPrice(100, "nope", 18)).toBeNull();
  });
});
