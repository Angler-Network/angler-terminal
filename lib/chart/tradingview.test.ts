import { describe, expect, it } from "vitest";
import { chartIntervals } from "./candles";
import { tradingViewInterval, tradingViewSymbol } from "./tradingview";

describe("tradingViewSymbol", () => {
  it("opens crypto on the Binance perpetual and stocks by ticker", () => {
    expect(tradingViewSymbol("btc", false)).toBe("BINANCE:BTCUSDT.P");
    expect(tradingViewSymbol("NVDA", true)).toBe("NVDA");
    expect(tradingViewSymbol("xyz:TSLA", true)).toBe("TSLA");
  });
});

describe("tradingViewInterval", () => {
  it("maps every terminal interval", () => {
    for (const interval of chartIntervals) expect(tradingViewInterval(interval)).toBeTruthy();
    expect(tradingViewInterval("1h")).toBe("60");
    expect(tradingViewInterval("1d")).toBe("D");
  });
});
