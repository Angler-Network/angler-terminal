import { describe, expect, it } from "vitest";
import { DEFAULT_API_KEY_INDEX, readLighterConfig } from "./config";

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
