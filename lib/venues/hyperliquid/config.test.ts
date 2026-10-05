import { describe, expect, it } from "vitest";
import { feeToPercent, readHlConfig } from "./config";

const BUILDER = "0x1234567890abcdef1234567890ABCDEF12345678";

describe("readHlConfig", () => {
  it("defaults to testnet", () => {
    expect(readHlConfig({})).toMatchObject({ network: "testnet", isTestnet: true, apiUrl: "https://api.hyperliquid-testnet.xyz", builder: null });
  });

  it("switches to mainnet from config only", () => {
    expect(readHlConfig({ NEXT_PUBLIC_HL_NETWORK: "mainnet" })).toMatchObject({ isTestnet: false, apiUrl: "https://api.hyperliquid.xyz" });
  });

  it("reads the builder, caps fees at the perp maximum and keeps max >= fee", () => {
    const config = readHlConfig({ NEXT_PUBLIC_HL_BUILDER_ADDRESS: BUILDER, NEXT_PUBLIC_HL_BUILDER_FEE: "250", NEXT_PUBLIC_HL_MAX_BUILDER_FEE: "5" });
    expect(config.builder).toEqual({ address: BUILDER.toLowerCase(), fee: 100, maxFee: 100 });
  });

  it("ignores malformed builder addresses and the zero-address placeholder", () => {
    expect(readHlConfig({ NEXT_PUBLIC_HL_BUILDER_ADDRESS: "0x123" }).builder).toBeNull();
    expect(readHlConfig({ NEXT_PUBLIC_HL_BUILDER_ADDRESS: `0x${"0".repeat(40)}` }).builder).toBeNull();
  });
});

describe("feeToPercent", () => {
  it("converts tenths of a basis point to the approveBuilderFee percent string", () => {
    expect(feeToPercent(10)).toBe("0.01%");
    expect(feeToPercent(25)).toBe("0.025%");
    expect(feeToPercent(100)).toBe("0.1%");
  });
});
