import { describe, expect, it } from "vitest";
import { defaultSize, perpSizePresets, sideLabel, sizePresets } from "./presets";

describe("presets", () => {
  it("keeps perp presets at or above Hyperliquid's $10 minimum, small in development", () => {
    expect(perpSizePresets({ NODE_ENV: "development" })).toEqual([10, 25, 50]);
    expect(perpSizePresets({ NODE_ENV: "production", NEXT_PUBLIC_PERP_SIZE_PRESETS: "20,40" })).toEqual([20, 40]);
  });

  it("has three presets per venue for the 1/2/3 shortcuts", () => {
    expect(sizePresets.perp).toHaveLength(3);
    expect(sizePresets.spot.length).toBeLessThanOrEqual(3);
  });

  it("uses the user's default size or the first preset", () => {
    expect(defaultSize("spot", null)).toBe(sizePresets.spot[0]);
    expect(defaultSize("perp", 42)).toBe(42);
  });

  it("labels sides per venue", () => {
    expect(sideLabel("perp", "buy")).toBe("Long");
    expect(sideLabel("perp", "sell")).toBe("Short");
    expect(sideLabel("spot", "buy")).toBe("Buy");
    expect(sideLabel("spot", "sell")).toBe("Sell");
  });
});
