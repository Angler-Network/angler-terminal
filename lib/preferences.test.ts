import { describe, expect, it } from "vitest";
import { APPEARANCE_VERSION, VENUES_VERSION, navModeChange, parsePreferences } from "./preferences";

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
    expect(parsePreferences(JSON.stringify({ preferredPerpVenue: "lighter", venueLighter: false, venuesSeen: ["lighter"] }))).toMatchObject({
      preferredPerpVenue: "lighter",
      venueLighter: false,
    });
    expect(parsePreferences(JSON.stringify({ preferredPerpVenue: "binance" })).preferredPerpVenue).toBe("hyperliquid");
  });
});

describe("order panel preferences", () => {
  it("defaults to icon buttons for every venue and confirming by click", () => {
    expect(parsePreferences(null)).toMatchObject({ venuePicker: "icons", hiddenVenueIcons: [], orderConfirm: "click" });
  });

  it("reads stored choices and drops unknown values", () => {
    expect(parsePreferences(JSON.stringify({ venuePicker: "dropdown", hiddenVenueIcons: ["aster", "binance", "orderly"], orderConfirm: "hold" }))).toMatchObject({
      venuePicker: "dropdown",
      hiddenVenueIcons: ["aster", "orderly"],
      orderConfirm: "hold",
    });
    expect(parsePreferences(JSON.stringify({ venuePicker: "grid", hiddenVenueIcons: "aster", orderConfirm: "double" }))).toMatchObject({
      venuePicker: "icons",
      hiddenVenueIcons: [],
      orderConfirm: "click",
    });
  });
});

describe("markets preferences", () => {
  it("defaults to the funding view with five venues", () => {
    expect(parsePreferences(null)).toMatchObject({ marketsView: "funding", fundingCompare: ["hyperliquid", "lighter", "aster", "binance", "bybit"] });
  });

  it("keeps a saved selection in venue order and never adds venues to it", () => {
    expect(parsePreferences(JSON.stringify({ marketsView: "overview", fundingCompare: ["bybit", "orderly", "ftx"] }))).toMatchObject({
      marketsView: "overview",
      fundingCompare: ["orderly", "bybit"],
    });
    expect(parsePreferences(JSON.stringify({ fundingCompare: [] })).fundingCompare).toEqual(["hyperliquid", "lighter", "aster", "binance", "bybit"]);
  });
});

describe("panel preferences", () => {
  it("shows every panel but the optional watchlist by default and keeps the stored choices", () => {
    expect(parsePreferences(null).panels).toEqual({ orderbook: true, orderEntry: true, positions: true, news: true, account: true, watchlist: false });
    expect(parsePreferences(JSON.stringify({ panels: { orderbook: false, news: "no", watchlist: true } })).panels).toMatchObject({
      orderbook: false,
      news: true,
      watchlist: true,
    });
  });
});

describe("navigation and tape preferences", () => {
  it("defaults to the sidebar with the tape on top and reads stored choices", () => {
    expect(parsePreferences(null)).toMatchObject({ navMode: "sidebar", tapePosition: "top" });
    expect(parsePreferences(JSON.stringify({ navMode: "top", tapePosition: "bottom" }))).toMatchObject({ navMode: "top", tapePosition: "bottom" });
    expect(parsePreferences(JSON.stringify({ navMode: "left", tapePosition: "side" }))).toMatchObject({ navMode: "sidebar", tapePosition: "top" });
  });
});

describe("navModeChange", () => {
  it("drops the tape to the footer when navigation moves to the top bar", () => {
    expect(navModeChange("top", "top")).toEqual({ navMode: "top", tapePosition: "bottom" });
    expect(navModeChange("top", "off")).toEqual({ navMode: "top", tapePosition: "off" });
    expect(navModeChange("sidebar", "bottom")).toEqual({ navMode: "sidebar", tapePosition: "bottom" });
  });
});

describe("venue switches", () => {
  it("drops switches saved before venuesSeen existed, once", () => {
    const old = parsePreferences(JSON.stringify({ venueAster: false, venueArcus: false, venueTitan: false }));
    expect(old).toMatchObject({ venueAster: true, venueArcus: true, venueTitan: true, venuesVersion: VENUES_VERSION });
    expect(old.venuesSeen).toContain("titan");
  });

  it("keeps a switch the user turned off while the venue was offered", () => {
    const chosen = parsePreferences(JSON.stringify({ venueAster: false, venueTitan: false, venuesVersion: VENUES_VERSION, venuesSeen: ["aster", "titan"] }));
    expect(chosen).toMatchObject({ venueAster: false, venueTitan: false });
  });

  it("ignores an off saved while the venue wasn't offered yet (its key came later)", () => {
    const later = parsePreferences(JSON.stringify({ venueTitan: false, venueJupiter: false, venuesVersion: VENUES_VERSION, venuesSeen: ["jupiter"] }));
    expect(later).toMatchObject({ venueTitan: true, venueJupiter: false });
  });
});
