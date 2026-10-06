import { describe, expect, it } from "vitest";
import { mainnetSpotAllowed, pinnedNetwork, readDeployment } from "./deployment";

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

  it("keeps mainnet-only spot venues off testnet builds", () => {
    expect(mainnetSpotAllowed("testnet")).toBe(false);
    expect(mainnetSpotAllowed("mainnet")).toBe(true);
    expect(mainnetSpotAllowed(null)).toBe(true);
  });
});
