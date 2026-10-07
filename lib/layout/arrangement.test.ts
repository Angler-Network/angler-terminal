import { describe, expect, it } from "vitest";
import { defaultArrangement, dropOnto, positionsSpanRail, readArrangement } from "./arrangement";

describe("arrangement", () => {
  it("reads only complete column orders and known stack panels", () => {
    expect(readArrangement(null)).toEqual(defaultArrangement);
    expect(readArrangement({ columns: ["main", "trade"], stack: "chart" })).toEqual(defaultArrangement);
    expect(readArrangement({ columns: ["rail", "main", "trade", "watchlist"], stack: "orderbook" })).toEqual({
      columns: ["rail", "main", "trade", "watchlist"],
      stack: "orderbook",
      version: 2,
    });
  });

  it("moves the old default to the order book next to the chart once", () => {
    const old = { columns: ["watchlist", "main", "trade", "rail"], stack: "news" };
    expect(readArrangement(old)).toEqual(defaultArrangement);
    // Chosen again after the move, it stays.
    expect(readArrangement({ ...old, version: 2 }).columns).toEqual(old.columns);
  });

  it("swaps the order book and news, or two columns, on a drop", () => {
    expect(dropOnto(defaultArrangement, { panel: "news" }, { column: "rail", panel: "orderbook" })?.stack).toBe("orderbook");
    expect(dropOnto(defaultArrangement, { column: "trade" }, { column: "main" })?.columns).toEqual(["watchlist", "trade", "rail", "main"]);
    // The rail is both a column and a panel: onto a column it moves as a column.
    expect(dropOnto(defaultArrangement, { column: "rail", panel: "orderbook" }, { column: "watchlist" })?.columns).toEqual(["rail", "main", "watchlist", "trade"]);
    expect(dropOnto(defaultArrangement, { column: "main" }, { column: "main" })).toBeNull();
  });

  it("runs the positions under the order book only when it sits next to the chart", () => {
    expect(positionsSpanRail(defaultArrangement, ["main", "rail", "trade"])).toBe(true);
    expect(positionsSpanRail(defaultArrangement, ["rail", "main", "trade"])).toBe(true);
    expect(positionsSpanRail(defaultArrangement, ["main", "trade", "rail"])).toBe(false);
    expect(positionsSpanRail({ ...defaultArrangement, stack: "orderbook" }, ["main", "rail", "trade"])).toBe(false);
    expect(positionsSpanRail(defaultArrangement, ["main", "trade"])).toBe(false);
  });
});
