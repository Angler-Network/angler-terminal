import { describe, expect, it } from "vitest";
import { pickVerifiedToken, toSpotToken } from "./tokens";

const records = [
  { id: "FakeWif111111111111111111111111111111111111", symbol: "WIF", name: "Fake", decimals: 6, liquidity: 9_000_000, isVerified: false },
  { id: "LowLiqWif11111111111111111111111111111111111", symbol: "wif", name: "Low", decimals: 6, liquidity: 10_000, isVerified: true },
  { id: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat", decimals: 6, liquidity: 5_000_000, tags: ["verified"] },
];

describe("pickVerifiedToken", () => {
  it("ignores unverified tokens and prefers the most liquid verified one", () => {
    expect(pickVerifiedToken(records, { symbol: "WIF" })?.mint).toBe("EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm");
  });

  it("matches a mint exactly and still requires verification", () => {
    expect(pickVerifiedToken(records, { mint: "LowLiqWif11111111111111111111111111111111111" })?.name).toBe("Low");
    expect(pickVerifiedToken(records, { mint: "FakeWif111111111111111111111111111111111111" })).toBeNull();
  });

  it("returns null when nothing verified matches", () => {
    expect(pickVerifiedToken(records, { symbol: "DOGE" })).toBeNull();
  });
});

describe("toSpotToken", () => {
  it("requires integer decimals from the token data", () => {
    expect(toSpotToken({ id: "x", symbol: "X" })).toBeNull();
    expect(toSpotToken({ id: "x", symbol: "X", decimals: 9, isVerified: true })?.decimals).toBe(9);
  });
});
