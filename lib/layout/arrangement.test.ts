import { describe, expect, it } from "vitest";
import { defaultArrangement, dropOnto, readArrangement } from "./arrangement";

describe("arrangement", () => {
  it("reads only complete column orders and known stack panels", () => {
    expect(readArrangement(null)).toEqual(defaultArrangement);
    expect(readArrangement({ columns: ["main", "trade"], stack: "chart" })).toEqual(defaultArrangement);
    expect(readArrangement({ columns: ["rail", "main", "trade", "watchlist"], stack: "orderbook" })).toEqual({
      columns: ["rail", "main", "trade", "watchlist"],
      stack: "orderbook",
    });
  });

  it("swaps the order book and news, or two columns, on a drop", () => {
    expect(dropOnto(defaultArrangement, { panel: "news" }, { column: "rail", panel: "orderbook" })?.stack).toBe("orderbook");
    expect(dropOnto(defaultArrangement, { column: "trade" }, { column: "main" })?.columns).toEqual(["watchlist", "trade", "main", "rail"]);
    // The rail is both a column and a panel: onto a column it moves as a column.
    expect(dropOnto(defaultArrangement, { column: "rail", panel: "orderbook" }, { column: "watchlist" })?.columns).toEqual(["rail", "main", "trade", "watchlist"]);
    expect(dropOnto(defaultArrangement, { column: "main" }, { column: "main" })).toBeNull();
  });
});
