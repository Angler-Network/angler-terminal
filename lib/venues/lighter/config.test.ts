import { describe, expect, it } from "vitest";
import { DEFAULT_API_KEY_INDEX, isLighterVenue, readLighterConfig } from "./config";

describe("readLighterConfig", () => {
  it("defaults to testnet with the terminal's key index and no integrator", () => {
    expect(readLighterConfig({})).toMatchObject({
      network: "testnet",
      isTestnet: true,
      apiUrl: "https://testnet.zklighter.elliot.ai",
      wsUrl: "wss://testnet.zklighter.elliot.ai/stream",
      chainId: 300,
      apiKeyIndex: DEFAULT_API_KEY_INDEX,
      integrator: null,
    });
  });

  it("switches to mainnet from config only", () => {
    expect(readLighterConfig({ NEXT_PUBLIC_LIGHTER_NETWORK: "mainnet" })).toMatchObject({
      apiUrl: "https://mainnet.zklighter.elliot.ai",
      wsUrl: "wss://mainnet.zklighter.elliot.ai/stream",
      chainId: 304,
      appUrl: "https://app.lighter.xyz",
    });
  });

  it("keeps the API key index out of the reserved 0-3 range and below 255", () => {
    expect(readLighterConfig({ NEXT_PUBLIC_LIGHTER_API_KEY_INDEX: "9" }).apiKeyIndex).toBe(9);
    for (const value of ["0", "3", "255", "-1", "4.5", "abc"]) {
      expect(readLighterConfig({ NEXT_PUBLIC_LIGHTER_API_KEY_INDEX: value }).apiKeyIndex).toBe(DEFAULT_API_KEY_INDEX);
    }
  });

  it("reads the integrator, caps fees and keeps max >= fee", () => {
    const config = readLighterConfig({
      NEXT_PUBLIC_LIGHTER_INTEGRATOR_ACCOUNT: "1234",
      NEXT_PUBLIC_LIGHTER_INTEGRATOR_FEE: "500",
      NEXT_PUBLIC_LIGHTER_MAX_INTEGRATOR_FEE: "100",
    });
    expect(config.integrator).toEqual({ accountIndex: 1234, takerFee: 500, maxTakerFee: 500 });
    expect(readLighterConfig({ NEXT_PUBLIC_LIGHTER_INTEGRATOR_ACCOUNT: "1", NEXT_PUBLIC_LIGHTER_INTEGRATOR_FEE: "99999" }).integrator?.takerFee).toBe(0);
    expect(readLighterConfig({ NEXT_PUBLIC_LIGHTER_INTEGRATOR_ACCOUNT: "" }).integrator).toBeNull();
  });
});

describe("Lighter on Robinhood Chain", () => {
  it("keeps its own host, chain id and storage, and never uses Robinhood's reserved key 157", () => {
    const rh = readLighterConfig({ NEXT_PUBLIC_LIGHTER_NETWORK: "mainnet" }, "rh");
    expect(rh).toMatchObject({
      instance: "rh",
      venue: "lighterRh",
      collateral: "USDG",
      apiUrl: "https://api.rh.lighter.xyz",
      wsUrl: "wss://api.rh.lighter.xyz/stream",
      chainId: 466324,
      storeKey: "rh-mainnet",
      appUrl: "https://robinhoodchain.lighter.xyz",
    });
    expect(readLighterConfig({}, "rh")).toMatchObject({ apiUrl: "https://api.rh-testnet.lighter.xyz", chainId: 300, storeKey: "rh-testnet", appUrl: null });
    // Lighter's Partner Attribution caps perp integrator fees at 10 bps (1000 millionths).
    expect(readLighterConfig({ NEXT_PUBLIC_LIGHTER_INTEGRATOR_ACCOUNT: "5", NEXT_PUBLIC_LIGHTER_INTEGRATOR_FEE: "1001" }).integrator?.takerFee).toBe(0);
    expect(readLighterConfig({ NEXT_PUBLIC_LIGHTER_API_KEY_INDEX: "157" }, "rh").apiKeyIndex).toBe(DEFAULT_API_KEY_INDEX);
    expect(readLighterConfig({ NEXT_PUBLIC_LIGHTER_API_KEY_INDEX: "157" }).apiKeyIndex).toBe(157);
    // Core keeps the bare network as its storage key, so existing browser keys stay found.
    expect(readLighterConfig({ NEXT_PUBLIC_LIGHTER_NETWORK: "mainnet" })).toMatchObject({ venue: "lighter", storeKey: "mainnet", chainId: 304 });
    expect(isLighterVenue("lighterRh") && isLighterVenue("lighter") && !isLighterVenue("hyperliquid")).toBe(true);
  });
});
