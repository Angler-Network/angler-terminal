import { describe, expect, it } from "vitest";
import { avatarSpec } from "./avatar";

describe("avatarSpec", () => {
  it("is stable per wallet and ignores address case", () => {
    const address = "0x454AFa0a5A59E7CA968D28831298c0A2530862dC";
    expect(avatarSpec(address)).toEqual(avatarSpec(address.toLowerCase()));
  });

  it("gives different wallets different pictures, inside the canvas", () => {
    const specs = Array.from({ length: 50 }, (_, index) => avatarSpec(`0x${index.toString(16).padStart(40, "0")}`));
    expect(new Set(specs.map((spec) => JSON.stringify(spec))).size).toBe(50);
    for (const spec of specs) {
      expect(spec.blobs).toHaveLength(3);
      for (const blob of spec.blobs) {
        expect(blob.cx).toBeGreaterThanOrEqual(10);
        expect(blob.cx).toBeLessThanOrEqual(70);
        expect(blob.r).toBeGreaterThanOrEqual(22);
      }
    }
  });
});
