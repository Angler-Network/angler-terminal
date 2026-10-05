import { describe, expect, it } from "vitest";
import { isSolanaAddress, readJupServerConfig, spotSizePresets } from "./config";

const REFERRAL = "REFer1111111111111111111111111111111111111";

describe("readJupServerConfig", () => {
  it("passes referral only when account and an in-range fee are both set", () => {
    expect(readJupServerConfig({ JUP_REFERRAL_ACCOUNT: REFERRAL, JUP_REFERRAL_FEE_BPS: "50" }).referral).toEqual({ account: REFERRAL, feeBps: 50 });
    expect(readJupServerConfig({ JUP_REFERRAL_ACCOUNT: REFERRAL, JUP_REFERRAL_FEE_BPS: "20" }).referral).toBeNull();
    expect(readJupServerConfig({ JUP_REFERRAL_ACCOUNT: REFERRAL, JUP_REFERRAL_FEE_BPS: "300" }).referral).toBeNull();
    expect(readJupServerConfig({ JUP_REFERRAL_FEE_BPS: "50" }).referral).toBeNull();
  });

  it("reads the key and RPC URL", () => {
    expect(readJupServerConfig({ JUP_API_KEY: " k " }).apiKey).toBe("k");
    expect(readJupServerConfig({}).apiKey).toBeNull();
    expect(readJupServerConfig({}).rpcUrl).toBe("https://api.mainnet-beta.solana.com");
  });
});

describe("spotSizePresets", () => {
  it("keeps sizes tiny outside production", () => {
    expect(spotSizePresets({ NODE_ENV: "development" })).toEqual([1, 2, 5, 10]);
    expect(spotSizePresets({ NODE_ENV: "production" })[0]).toBeGreaterThan(5);
    expect(spotSizePresets({ NODE_ENV: "production", NEXT_PUBLIC_SPOT_SIZE_PRESETS: "1, 2,x" })).toEqual([1, 2]);
  });
});

describe("isSolanaAddress", () => {
  it("accepts base58 addresses only", () => {
    expect(isSolanaAddress("So11111111111111111111111111111111111111112")).toBe(true);
    expect(isSolanaAddress("0x1234")).toBe(false);
    expect(isSolanaAddress("O0Il".repeat(10))).toBe(false);
  });
});
