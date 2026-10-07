import { describe, expect, it } from "vitest";
import { chartQuote, parseChartCookie, pickQuote, serializeChartCookie, type Market } from "./model";

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

describe("chart cookie", () => {
  it("round-trips the chart settings", () => {
    const settings = { symbol: "NVDA", market: "perp" as const, source: "hyperliquid" as const };
    expect(parseChartCookie(serializeChartCookie(settings))).toEqual(settings);
  });

  it("rejects missing or malformed values", () => {
    expect(parseChartCookie(undefined)).toBeNull();
    expect(parseChartCookie("%E0%A4%A")).toBeNull();
    expect(parseChartCookie(encodeURIComponent("BTC<script>|perp|binance"))).toBeNull();
    expect(parseChartCookie(encodeURIComponent("BTC|futures|binance"))).toBeNull();
    expect(parseChartCookie(encodeURIComponent("BTC|perp|lighter"))).toBeNull();
  });
});

describe("chartQuote", () => {
  const markets: Market[] = [
    { symbol: "BTC", kind: "crypto", volume: 1, quotes: { binance: { price: 100, changePct: 1 }, hyperliquid: { price: 101, changePct: 2 } } },
  ];

  it("picks the settings' source for the chart symbol", () => {
    expect(chartQuote(markets, { symbol: "BTC", market: "perp", source: "hyperliquid" })).toEqual({ symbol: "BTC", price: 101, changePct: 2 });
  });

  it("is null for an unknown symbol", () => {
    expect(chartQuote(markets, { symbol: "ETH", market: "perp", source: "binance" })).toBeNull();
  });
});
