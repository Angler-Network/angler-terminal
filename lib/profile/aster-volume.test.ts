import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { asterAnglerVolume } = await import("./aster-volume");

describe("Aster volume", () => {
  it("sums the wallet's builder trades and our fee on them", () => {
    const user = "0x00000000000000000000000000000000000000a1";
    const result = asterAnglerVolume(
        [
          { insertTime: 5, totalQuota: "1000", builderFee: "0.35", userAddress: user.toUpperCase().replace("0X", "0x") },
          { insertTime: 9, totalQuota: "-500", builderFee: "0.175", userAddress: user },
          { insertTime: 7, totalQuota: "9999", builderFee: "9", userAddress: "0x00000000000000000000000000000000000000b2" },
        ],
        user,
      );
    expect(result).toMatchObject({ usd: 1500, lastTime: 9 });
    expect(result.fee).toBeCloseTo(0.525);
  });
});
