import { describe, expect, it } from "vitest";
import type { VenueMarket } from "@/lib/venues/types";
import { assetRows, sortAssetRows } from "./rows";

function market(venue: VenueMarket["venue"], symbol: string, extra: Partial<VenueMarket> = {}): VenueMarket {
  return { venue, coin: symbol, symbol, dex: "", assetId: 0, szDecimals: 2, maxLeverage: 10, kind: "crypto", onlyIsolated: false, ...extra };
}

describe("assetRows", () => {
  const rows = assetRows({
    hyperliquid: [
      market("hyperliquid", "BTC", { markPx: 100, volume24hUsd: 900, openInterestUsd: 50, change24hPct: 2 }),
      market("hyperliquid", "NVDA", { dex: "xyz", coin: "xyz:NVDA", kind: "stock", volume24hUsd: 300_000, change24hPct: -4 }),
    ],
    lighter: [market("lighter", "BTC", { markPx: 101, volume24hUsd: 1000, openInterestUsd: 20, change24hPct: 3 })],
    lighterRh: [market("lighterRh", "ETH", { markPx: 10, volume24hUsd: 500_000, change24hPct: 7 })],
  });
  const btc = rows.find((row) => row.symbol === "BTC")!;

  it("merges every venue, quoting the busiest one", () => {
    expect(Object.keys(btc.venues)).toEqual(["hyperliquid", "lighter"]);
    expect(btc).toMatchObject({ volume: 1900, openInterest: 70, price: 101, change24hPct: 3 });
    expect(rows.find((row) => row.symbol === "ETH")?.venues.lighterRh).toBeDefined();
    expect(rows.find((row) => row.symbol === "NVDA")).toMatchObject({ kind: "stock", category: "stocks" });
  });

  it("sorts by volume, and ranks movers with real volume", () => {
    expect(sortAssetRows(rows, "volume").map((row) => row.symbol)).toEqual(["ETH", "NVDA", "BTC"]);
    expect(sortAssetRows(rows, "gainers").map((row) => row.symbol)).toEqual(["ETH", "NVDA"]);
    expect(sortAssetRows(rows, "losers").map((row) => row.symbol)).toEqual(["NVDA", "ETH"]);
  });
});
