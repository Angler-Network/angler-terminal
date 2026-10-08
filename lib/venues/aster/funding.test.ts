import { describe, expect, it } from "vitest";
import { asterFundingRows, splitAsterSymbol } from "./funding";

describe("Aster funding", () => {
  it("normalizes to 8 hours and keeps the USDT market of a base", () => {
    expect(splitAsterSymbol("BTCUSDT")).toEqual({ base: "BTC", quote: "USDT" });
    expect(splitAsterSymbol("XAUUSD1")).toEqual({ base: "XAU", quote: "USD1" });
    expect(splitAsterSymbol("ABCU")).toBeNull();
    const rows = asterFundingRows(
      [
        { symbol: "XAUUSD1", markPrice: "4100", lastFundingRate: "0.0002" },
        { symbol: "BTCUSDT", markPrice: "83000", lastFundingRate: "0.0001" },
        { symbol: "BTCUSD1", markPrice: "83000", lastFundingRate: "0.0005" },
        { symbol: "HYPEUSDT", markPrice: "40", lastFundingRate: "0.00005" },
        { symbol: "DEADUSDT", markPrice: "0", lastFundingRate: "0.1" },
      ],
      [{ symbol: "HYPEUSDT", fundingIntervalHours: 4 }],
    );
    expect(rows).toEqual([
      { exchange: "aster", symbol: "XAU", rate: 0.0002 },
      { exchange: "aster", symbol: "BTC", rate: 0.0001 },
      { exchange: "aster", symbol: "HYPE", rate: 0.0001 },
    ]);
  });
});
