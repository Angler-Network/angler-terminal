import { describe, expect, it } from "vitest";
import { compareExecution, estimateFill, readLighterRestBook } from "./execution";

const book = (asks: Array<[number, number]>, bids: Array<[number, number]>) => ({
  asks: asks.map(([price, size]) => ({ price, size })),
  bids: bids.map(([price, size]) => ({ price, size })),
});

describe("estimateFill", () => {
  it("walks levels and averages the price", () => {
    // $150 buys 1 at 100 and 0.5 at 100... then 50/110.
    const fill = estimateFill([{ price: 100, size: 1 }, { price: 110, size: 1 }], 160)!;
    expect(fill.complete).toBe(true);
    expect(fill.base).toBeCloseTo(1 + 60 / 110);
    expect(fill.avgPx).toBeCloseTo(160 / (1 + 60 / 110));
    expect(estimateFill([{ price: 100, size: 1 }], 500)?.complete).toBe(false);
    expect(estimateFill([], 100)).toBeNull();
  });
});

describe("compareExecution", () => {
  it("picks the cheaper venue after fees and prices the gap", () => {
    const quotes = compareExecution("buy", 1000, [
      { venue: "hyperliquid", book: book([[100, 100]], [[99.9, 100]]), takerFee: 0.00055 },
      { venue: "lighter", book: book([[100.02, 100]], [[99.9, 100]]), takerFee: 0 },
    ]);
    // Lighter: 100.02 vs Hyperliquid 100 * 1.00055 = 100.055.
    expect(quotes[0].venue).toBe("lighter");
    expect(quotes[1].costVsBestUsd).toBeCloseTo((100.055 - 100.02) * (1000 / 100.02), 6);
  });

  it("prefers a venue that fills the whole size, and sells to the highest bid", () => {
    const thin = book([[99, 0.1]], [[101, 0.1]]);
    const deep = book([[100, 100]], [[100, 100]]);
    expect(compareExecution("buy", 1000, [{ venue: "a", book: thin, takerFee: 0 }, { venue: "b", book: deep, takerFee: 0 }])[0].venue).toBe("b");
    expect(compareExecution("sell", 5, [{ venue: "a", book: thin, takerFee: 0 }, { venue: "b", book: deep, takerFee: 0 }])[0].venue).toBe("a");
  });
});

describe("readLighterRestBook", () => {
  it("aggregates orders at the same price", () => {
    const parsed = readLighterRestBook({
      asks: [
        { price: "85897.9", remaining_base_amount: "3.05531" },
        { price: "85897.9", remaining_base_amount: "0.01850" },
        { price: "85898.5", remaining_base_amount: "0.03" },
      ],
      bids: [{ price: "85890", remaining_base_amount: "1" }],
    });
    expect(parsed.asks[0]).toEqual({ price: 85897.9, size: 3.05531 + 0.0185 });
    expect(parsed.asks).toHaveLength(2);
    expect(parsed.bids[0].price).toBe(85890);
  });
});
