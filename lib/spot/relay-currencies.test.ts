import { describe, expect, it } from "vitest";
import brett from "./fixtures/relay-currencies-brett.json";
import { readRelayCurrencies } from "./relay-currencies";

describe("Relay token search", () => {
  it("lists hits on the swap chains as unverified Uniswap listings with decimals", () => {
    const listings = readRelayCurrencies(brett);
    expect(listings.length).toBeGreaterThan(0);
    const base = listings.find((listing) => listing.chainId === 8453 && listing.symbol === "BRETT")!;
    expect(base).toMatchObject({ venue: "uniswap", decimals: 18, verified: false });
    expect(base.id).toBe(`uniswap:8453:${base.address.toLowerCase()}`);
    expect(new Set(listings.map((listing) => listing.id)).size).toBe(listings.length);
  });

  it("drops other chains and bad entries", () => {
    expect(readRelayCurrencies([{ chainId: 56, address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", symbol: "X", decimals: 18 }])).toEqual([]);
    expect(readRelayCurrencies([{ chainId: 8453, address: "nope", symbol: "X", decimals: 18 }])).toEqual([]);
    expect(readRelayCurrencies(null)).toEqual([]);
  });
});
