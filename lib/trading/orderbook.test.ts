import { describe, expect, it } from "vitest";
import hlBook from "./fixtures/hl-l2book.json";
import {
  applyLevels,
  groupLevels,
  readHlBook,
  readHlTrades,
  readLighterBook,
  readLighterTrades,
  sortedSide,
  spreadOf,
  tickOptions,
  withTotals,
} from "./orderbook";

describe("venue parsers", () => {
  it("reads a real Hyperliquid l2Book", () => {
    const book = readHlBook(hlBook)!;
    expect(book.bids[0]).toEqual({ price: 86021, size: 0.3 });
    expect(book.asks[0].price).toBeGreaterThan(book.bids[0].price);
    expect(spreadOf(book)?.value).toBe(1);
  });

  it("reads trades from both venues with the taker side", () => {
    expect(readHlTrades([{ coin: "BTC", side: "A", px: "100.5", sz: "2", time: 1, tid: 7 }])).toEqual([
      { id: "7", price: 100.5, size: 2, side: "sell", time: 1 },
    ]);
    // Lighter docs example: maker on the bid, so the taker sold.
    const lighter = readLighterTrades({ trades: [{ trade_id_str: "9", price: "2181.83", size: "0.1336", is_maker_ask: false, timestamp: 5 }] });
    expect(lighter).toEqual([{ id: "9", price: 2181.83, size: 0.1336, side: "sell", time: 5 }]);
  });

  it("applies Lighter deltas, where size 0 removes a level", () => {
    const asks = new Map<number, number>();
    applyLevels(asks, readLighterBook({ order_book: { asks: [{ price: "10", size: "1" }, { price: "11", size: "2" }], bids: [] } })!.asks);
    applyLevels(asks, readLighterBook({ order_book: { asks: [{ price: "10", size: "0" }, { price: "12", size: "3" }] } })!.asks);
    expect(sortedSide(asks, "asks")).toEqual([
      { price: 11, size: 2 },
      { price: 12, size: 3 },
    ]);
  });
});

describe("grouping and depth", () => {
  it("buckets bids down and asks up", () => {
    const bids = [
      { price: 100.7, size: 1 },
      { price: 100.2, size: 2 },
      { price: 99.9, size: 1 },
    ];
    expect(groupLevels(bids, 1, "bids")).toEqual([
      { price: 100, size: 3 },
      { price: 99, size: 1 },
    ]);
    expect(groupLevels([{ price: 100.2, size: 1 }, { price: 100.9, size: 1 }], 1, "asks")).toEqual([{ price: 101, size: 2 }]);
    expect(groupLevels([{ price: 86021, size: 1 }], 0.1, "bids")).toEqual([{ price: 86021, size: 1 }]);
  });

  it("adds running totals and offers grouping steps", () => {
    expect(withTotals([{ price: 1, size: 1 }, { price: 2, size: 2 }]).map((row) => row.total)).toEqual([1, 3]);
    expect(tickOptions(86000)).toEqual([1, 10, 100]);
    expect(tickOptions(0.5)).toEqual([0.00001, 0.0001, 0.001]);
  });
});
