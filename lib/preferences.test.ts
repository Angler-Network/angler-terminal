import { describe, expect, it } from "vitest";
import { APPEARANCE_VERSION, parsePreferences } from "./preferences";

describe("appearance defaults", () => {
  it("defaults to the OLED theme with the Liquid surface", () => {
    expect(parsePreferences(null)).toMatchObject({ theme: "oled", surfaceStyle: "liquid" });
  });

  it("moves older saved looks to the new default once, keeping other preferences", () => {
    const old = parsePreferences(JSON.stringify({ theme: "deepnavy", surfaceStyle: "solid", oneClickTrading: true }));
    expect(old).toMatchObject({ theme: "oled", surfaceStyle: "liquid", oneClickTrading: true, appearanceVersion: APPEARANCE_VERSION });
  });

  it("keeps a look chosen after the change", () => {
    const current = parsePreferences(JSON.stringify({ theme: "midnight", surfaceStyle: "glass", appearanceVersion: APPEARANCE_VERSION }));
    expect(current).toMatchObject({ theme: "midnight", surfaceStyle: "glass" });
  });
});

describe("perp venue preferences", () => {
  it("defaults to Hyperliquid first with Lighter enabled as the fallback", () => {
    expect(parsePreferences(null)).toMatchObject({ venueHyperliquid: true, venueLighter: true, preferredPerpVenue: "hyperliquid" });
  });

  it("reads a stored Lighter preference and rejects unknown venues", () => {
    expect(parsePreferences(JSON.stringify({ preferredPerpVenue: "lighter", venueLighter: false }))).toMatchObject({
      preferredPerpVenue: "lighter",
      venueLighter: false,
    });
    expect(parsePreferences(JSON.stringify({ preferredPerpVenue: "binance" })).preferredPerpVenue).toBe("hyperliquid");
  });
});

describe("panel preferences", () => {
  it("shows every panel by default and keeps the stored choices", () => {
    expect(parsePreferences(null).panels).toEqual({ orderbook: true, orderEntry: true, positions: true, news: true, account: true });
    expect(parsePreferences(JSON.stringify({ panels: { orderbook: false, news: "no" } })).panels).toMatchObject({ orderbook: false, news: true });
  });
});
