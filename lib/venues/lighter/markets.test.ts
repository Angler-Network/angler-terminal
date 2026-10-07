import { describe, expect, it } from "vitest";
import details from "./fixtures/order-book-details.json";
import { findLighterMarket, findLighterMarketById, forInstance, marketsFromDetails, maxLeverageFor, readOrderBookDetails } from "./markets";

// Live testnet orderBookDetails (2026-10-05) plus one inactive mainnet market.
describe("orderBookDetails", () => {
  const markets = readOrderBookDetails(details);

  it("keeps active perps only, with ids and decimals from the API", () => {
    expect(markets.map((market) => market.symbol)).toEqual(["SOL", "ETH", "BTC"]);
    expect(findLighterMarket(markets, "sol")).toMatchObject({
      venue: "lighter",
      coin: "SOL",
      assetId: 4097,
      szDecimals: 3,
      priceDecimals: 3,
      minBaseAmount: 0.05,
      minQuoteAmount: 10,
      maxLeverage: 25,
      markPx: 119.857,
      onlyIsolated: false,
    });
  });

  it("reads 24h volume and open interest in USD", () => {
    const sol = findLighterMarket(markets, "SOL")!;
    expect(sol.volume24hUsd).toBeCloseTo(665869.12, 1);
    expect(sol.openInterestUsd).toBeCloseTo(154.919 * 119.857, 3);
  });

  it("finds markets by symbol and id", () => {
    expect(findLighterMarket(markets, "DOGE")).toBeNull();
    expect(findLighterMarketById(markets, 4095)?.symbol).toBe("ETH");
  });

  it("derives max leverage from the minimum initial margin fraction", () => {
    expect(maxLeverageFor(400)).toBe(25);
    expect(maxLeverageFor(200)).toBe(50);
    expect(maxLeverageFor(666)).toBe(15);
    expect(maxLeverageFor(0)).toBe(1);
  });

  it("skips malformed, hidden and spot entries", () => {
    const [sol] = details.order_book_details;
    expect(
      marketsFromDetails([
        { ...sol, symbol: "bad symbol!" },
        { ...sol, market_config: { ...sol.market_config, hidden: true } },
        { ...sol, market_type: "spot" },
        { ...sol, size_decimals: "3" },
        null,
      ]),
    ).toEqual([]);
    expect(readOrderBookDetails({ code: 29500 })).toEqual([]);
  });
});

describe("forInstance", () => {
  it("stamps the venue and splits Robinhood's stocks from its crypto by symbol", () => {
    const markets = readOrderBookDetails(details);
    const rh = forInstance({ venue: "lighterRh", instance: "rh" }, markets);
    expect(rh.every((market) => market.venue === "lighterRh")).toBe(true);
    expect(rh.find((market) => market.symbol === "ETH")?.kind).toBe("crypto");
    expect(forInstance({ venue: "lighterRh", instance: "rh" }, [{ ...markets[0], symbol: "NVDA", kind: "crypto" }])[0].kind).toBe("stock");
    // Core keeps Lighter's own classification.
    expect(forInstance({ venue: "lighter", instance: "core" }, markets)).toEqual(markets);
  });
});
