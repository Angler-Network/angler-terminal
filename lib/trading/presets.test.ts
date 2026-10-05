import { describe, expect, it } from "vitest";
import { defaultSize, perpSizePresets, presetLabel, sideLabel, sizePresets } from "./presets";

describe("presets", () => {
  it("keeps perp presets at or above Hyperliquid's $10 minimum, small in development", () => {
    expect(perpSizePresets({ NODE_ENV: "development" })).toEqual([10, 25, 50, 100]);
    expect(perpSizePresets({ NODE_ENV: "production" })).toEqual([250, 500, 750, 1000]);
    expect(perpSizePresets({ NODE_ENV: "production", NEXT_PUBLIC_PERP_SIZE_PRESETS: "20,40" })).toEqual([20, 40]);
  });

  it("has four presets per venue for the 1-4 shortcuts", () => {
    expect(sizePresets.perp).toHaveLength(4);
    expect(sizePresets.spot.length).toBeLessThanOrEqual(4);
  });

  it("formats compact labels", () => {
    expect(presetLabel(250)).toBe("250");
    expect(presetLabel(1000)).toBe("1k");
    expect(presetLabel(2500)).toBe("2.5k");
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
