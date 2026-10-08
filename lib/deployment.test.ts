import { describe, expect, it } from "vitest";
import { pinnedNetwork, readConfiguredVenues, readDeployment, swapViewAvailable, venueAvailable } from "./deployment";

describe("deployment", () => {
  it("reads the deployment", () => {
    expect(readDeployment("mainnet")).toBe("mainnet");
    expect(readDeployment("testnet")).toBe("testnet");
    expect(readDeployment("staging")).toBeNull();
    expect(readDeployment(undefined)).toBeNull();
  });

  it("pins venue networks and ignores browser overrides on pinned builds", () => {
    expect(pinnedNetwork("mainnet", "testnet", "testnet")).toBe("mainnet");
    expect(pinnedNetwork("testnet", "mainnet", "mainnet")).toBe("testnet");
    expect(pinnedNetwork(null, "mainnet", "testnet")).toBe("mainnet");
    expect(pinnedNetwork(null, undefined, "testnet")).toBe("testnet");
  });

  it("offers only configured venues on the mainnet site", () => {
    const configured = readConfiguredVenues("hyperliquid, lighter,jupiter");
    expect(venueAvailable("hyperliquid", "mainnet", configured)).toBe(true);
    expect(venueAvailable("titan", "mainnet", configured)).toBe(false);
    expect(venueAvailable("arcus", "mainnet", configured)).toBe(false);
    expect(venueAvailable("arcus", "testnet", new Set())).toBe(true);
    expect(venueAvailable("jupiter", "testnet", configured)).toBe(false);
    expect(venueAvailable("titan", null, new Set())).toBe(true);
    expect(venueAvailable("uniswap", "testnet", new Set(["uniswap"]))).toBe(false);
    expect(venueAvailable("uniswap", "mainnet", new Set(["uniswap"]))).toBe(true);
    // EVM aggregators only quote mainnet chains: never on the testnet site, even when configured.
    expect(venueAvailable("zerox", "testnet", new Set(["zerox"]))).toBe(false);
    expect(venueAvailable("kyberswap", "testnet", new Set(["kyberswap"]))).toBe(false);
    expect(venueAvailable("zerox", "mainnet", new Set(["zerox"]))).toBe(true);
    expect(readConfiguredVenues(undefined).size).toBe(0);
  });

  it("has no Swap view on the testnet site", () => {
    expect(swapViewAvailable("testnet")).toBe(false);
    expect(swapViewAvailable("mainnet")).toBe(true);
    expect(swapViewAvailable(null)).toBe(true);
  });
});
