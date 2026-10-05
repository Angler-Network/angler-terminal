import { describe, expect, it } from "vitest";
import { perpVenueOrder, pickPerpMarket } from "./routing";
import type { VenueMarket } from "./types";

function market(venue: VenueMarket["venue"], symbol: string, dex = ""): VenueMarket {
  return { venue, coin: dex ? `${dex}:${symbol}` : symbol, symbol, dex, assetId: 1, szDecimals: 2, maxLeverage: 10, kind: "crypto", onlyIsolated: false };
}

const hyperliquid = [market("hyperliquid", "BTC"), market("hyperliquid", "NVDA", "xyz")];
const lighter = [market("lighter", "BTC"), market("lighter", "TSLA")];

describe("perp routing", () => {
  it("orders enabled venues with the preferred one first", () => {
    expect(perpVenueOrder("hyperliquid", { hyperliquid: true, lighter: true })).toEqual(["hyperliquid", "lighter"]);
    expect(perpVenueOrder("lighter", { hyperliquid: true, lighter: true })).toEqual(["lighter", "hyperliquid"]);
    expect(perpVenueOrder("lighter", { hyperliquid: true, lighter: false })).toEqual(["hyperliquid"]);
  });

  it("uses the preferred venue and falls back to the other", () => {
    const order = perpVenueOrder("hyperliquid", { hyperliquid: true, lighter: true });
    expect(pickPerpMarket("BTC", { hyperliquid, lighter }, order)?.venue).toBe("hyperliquid");
    expect(pickPerpMarket("NVDA", { hyperliquid, lighter }, order)?.coin).toBe("xyz:NVDA");
    expect(pickPerpMarket("TSLA", { hyperliquid, lighter }, order)?.venue).toBe("lighter");
    expect(pickPerpMarket("DOGE", { hyperliquid, lighter }, order)).toBeNull();
  });

  it("honours a Lighter preference", () => {
    expect(pickPerpMarket("BTC", { hyperliquid, lighter }, ["lighter", "hyperliquid"])?.venue).toBe("lighter");
  });

  it("waits only for venues that could still decide", () => {
    expect(pickPerpMarket("BTC", { hyperliquid: undefined, lighter }, ["hyperliquid", "lighter"])).toBeUndefined();
    expect(pickPerpMarket("BTC", { hyperliquid, lighter: undefined }, ["hyperliquid", "lighter"])?.venue).toBe("hyperliquid");
    expect(pickPerpMarket("TSLA", { hyperliquid, lighter: undefined }, ["hyperliquid", "lighter"])).toBeUndefined();
    expect(pickPerpMarket("TSLA", { hyperliquid, lighter: [] }, ["hyperliquid", "lighter"])).toBeNull();
  });
});
