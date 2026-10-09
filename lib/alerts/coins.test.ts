import { describe, expect, it } from "vitest";
import { alertPrices, mergeAlertCoins } from "./coins";
import { priceMessages } from "./rules";

describe("mergeAlertCoins", () => {
  it("lists Hyperliquid first, then only what other venues add, and drops spot and outcome ids", () => {
    const coins = mergeAlertCoins({ "xyz:NVDA": 180, ZRO: 2, ETH: 4000, BTC: 100000, "@107": 40, "#10": 0.5, kPEPE: 0.01, DEAD: 0 }, [
      { venue: "lighter", markets: [{ symbol: "BTC", price: 99990, stock: false }, { symbol: "EURUSD", price: 1.1, stock: false }, { symbol: "bad sym", price: 1, stock: false }] },
      { venue: "lighterrh", markets: [{ symbol: "NVDA", price: 181, stock: true }, { symbol: "HOOD", price: 120, stock: true }] },
      { venue: "aster", markets: [{ symbol: "EURUSD", price: 1.2, stock: false }, { symbol: "ASTER", price: 1.5, stock: false }, { symbol: "1000PEPE", price: 0.01, stock: false }, { symbol: "NOPRICE", price: undefined, stock: false }] },
    ]);
    expect(coins.map((entry) => entry.coin)).toEqual(["BTC", "ETH", "kPEPE", "ZRO", "xyz:NVDA", "aster:ASTER", "lighter:EURUSD", "lighterrh:HOOD"]);
    expect(coins.find((entry) => entry.coin === "lighterrh:HOOD")).toEqual({ coin: "lighterrh:HOOD", mid: 120, venue: "lighterrh", stock: true });
  });

  it("names the venue in a non-Hyperliquid price alert", () => {
    const prices = alertPrices(mergeAlertCoins({}, [{ venue: "aster", markets: [{ symbol: "ASTER", price: 2, stock: false }] }]));
    const { messages } = priceMessages([{ id: "a", coin: "aster:ASTER", direction: "above", price: 1.5 }], prices, []);
    expect(messages[0]).toBe("🎯 ASTER (Aster) is above $1.50 (now $2.00)");
  });
});
