import { describe, expect, it } from "vitest";
import { pickQuote, type Market } from "./model";

const market = (quotes: Market["quotes"]): Market => ({ symbol: "BTC", kind: "crypto", volume: 1, quotes });

describe("pickQuote", () => {
  it("prefers the chosen source, then the other one, then Lighter", () => {
    const binance = { price: 1, changePct: 0 };
    const hyperliquid = { price: 2, changePct: 0 };
    const lighter = { price: 3, changePct: 0 };
    expect(pickQuote(market({ binance, hyperliquid, lighter }), "hyperliquid")?.source).toBe("hyperliquid");
    expect(pickQuote(market({ binance, lighter }), "hyperliquid")?.source).toBe("binance");
    // On US servers Binance is geo-blocked and Hyperliquid can be rate limited: Lighter keeps the tape alive.
    expect(pickQuote(market({ lighter }), "binance")).toEqual({ source: "lighter", quote: lighter });
    expect(pickQuote(market({}), "binance")).toBeNull();
  });
});
