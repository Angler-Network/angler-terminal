import { describe, expect, it } from "vitest";
import details from "./fixtures/order-book-details.json";
import { findLighterMarket, findLighterMarketById, marketsFromDetails, maxLeverageFor, readOrderBookDetails } from "./markets";

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
