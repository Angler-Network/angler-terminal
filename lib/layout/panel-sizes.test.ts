import { describe, expect, it } from "vitest";
import { columnTrack, defaultPanelSizes, maxColumnWidth, readPanelSizes } from "./panel-sizes";

describe("readPanelSizes", () => {
  it("keeps valid sizes and clamps them to each panel's minimum", () => {
    expect(readPanelSizes({ watchlist: 240.4, side: 100, news: "wide", orderbook: 300 })).toEqual({
      watchlist: 240,
      side: 260,
      news: null,
      orderbook: 300,
    });
  });

  it("falls back to automatic sizes", () => {
    expect(readPanelSizes(undefined)).toBe(defaultPanelSizes);
    expect(readPanelSizes("x")).toBe(defaultPanelSizes);
    expect(readPanelSizes({ side: Number.NaN })).toEqual(defaultPanelSizes);
  });
});

describe("columnTrack", () => {
  it("uses the automatic clamp until dragged, then caps the width at its share", () => {
    expect(columnTrack("news", null)).toBe("clamp(290px,21vw,380px)");
    expect(columnTrack("side", 420)).toBe("min(420px, 32%)");
  });
});

describe("maxColumnWidth", () => {
  it("leaves the chart its minimum width", () => {
    expect(maxColumnWidth("news", 2000, 340)).toBe(640);
    expect(maxColumnWidth("news", 1100, 340)).toBe(352);
    // Never below the column's own minimum.
    expect(maxColumnWidth("side", 900, 600)).toBe(260);
  });
});
