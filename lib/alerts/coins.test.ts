import { describe, expect, it } from "vitest";
import { alertPrices, readAlertCoins } from "./coins";
import { priceMessages } from "./rules";

describe("readAlertCoins", () => {
  it("lists every venue's own coins, majors first, and drops spot ids, outcome ids and bad rows", () => {
    const coins = readAlertCoins({ "xyz:NVDA": 180, ZRO: 2, ETH: 4000, BTC: 100000, "@107": 40, "#10": 0.5, kPEPE: 0.01, DEAD: 0 }, [
      { venue: "lighter", markets: [{ symbol: "EURUSD", price: 1.1, stock: false }, { symbol: "BTC", price: 99990, stock: false }, { symbol: "bad sym", price: 1, stock: false }] },
      { venue: "lighterrh", markets: [{ symbol: "NVDA", price: 181, stock: true }] },
      { venue: "aster", markets: [{ symbol: "ASTER", price: 1.5, stock: false }, { symbol: "NOPRICE", price: undefined, stock: false }] },
    ]);
    expect(coins.map((entry) => entry.coin)).toEqual(["BTC", "ETH", "kPEPE", "ZRO", "xyz:NVDA", "lighter:BTC", "lighter:EURUSD", "lighterrh:NVDA", "aster:ASTER"]);
    expect(coins.find((entry) => entry.coin === "lighterrh:NVDA")).toEqual({ coin: "lighterrh:NVDA", mid: 181, venue: "lighterrh", stock: true });
  });

  it("names the venue in a non-Hyperliquid price alert", () => {
    const prices = alertPrices(readAlertCoins({}, [{ venue: "aster", markets: [{ symbol: "BTC", price: 2, stock: false }] }]));
    const { messages } = priceMessages([{ id: "a", coin: "aster:BTC", direction: "above", price: 1.5 }], prices, []);
    expect(messages[0]).toBe("🎯 BTC (Aster) is above $1.50 (now $2.00)");
  });

  it("prices Extended markets under their own prefix", () => {
    const coins = readAlertCoins({}, [
      { venue: "aster", markets: [{ symbol: "BTC", price: 2, stock: false }] },
      { venue: "extended", markets: [{ symbol: "BTC", price: 3, stock: false }] },
    ]);
    expect(coins.map((entry) => entry.coin)).toEqual(["aster:BTC", "extended:BTC"]);
    const { messages } = priceMessages([{ id: "a", coin: "extended:BTC", direction: "below", price: 4 }], alertPrices(coins), []);
    expect(messages[0]).toBe("🎯 BTC (Extended) is below $4.00 (now $3.00)");
  });
});
