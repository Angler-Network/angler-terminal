import { describe, expect, it } from "vitest";
import { splitExecution } from "./execution";
import { mergeVenueBooks } from "./orderbook";

const book = (asks: Array<[number, number]>, bids: Array<[number, number]> = []) => ({
  asks: asks.map(([price, size]) => ({ price, size })),
  bids: bids.map(([price, size]) => ({ price, size })),
});

describe("splitExecution", () => {
  it("takes the cheapest levels across venues and reports the saving", () => {
    // A: 1 unit at 100, then 102. B: 1 unit at 100.5, then 103. Buying $300 needs ~3 units.
    const plan = splitExecution("buy", 300, [
      { venue: "a", book: book([[100, 1], [102, 10]]), takerFee: 0 },
      { venue: "b", book: book([[100.5, 1], [103, 10]]), takerFee: 0 },
    ])!;
    expect(plan.legs.map((leg) => leg.venue)).toEqual(["a", "b"]);
    expect(plan.legs[0].usd).toBeCloseTo(199.5, 6);
    expect(plan.legs[1].usd).toBeCloseTo(100.5, 6);
    expect(plan.complete).toBe(true);
    expect(plan.savingsUsd).toBeGreaterThan(0);
  });

  it("counts fees: a cheaper book with a high fee loses its edge", () => {
    const plan = splitExecution("buy", 100, [
      { venue: "a", book: book([[100, 10]]), takerFee: 0.01 },
      { venue: "b", book: book([[100.5, 10]]), takerFee: 0 },
    ]);
    expect(plan).toBeNull();
  });

  it("splits sells on bids", () => {
    const plan = splitExecution("sell", 300, [
      { venue: "a", book: book([], [[100, 1], [98, 10]]), takerFee: 0 },
      { venue: "b", book: book([], [[99.5, 1], [97, 10]]), takerFee: 0 },
    ])!;
    expect(plan.legs.map((leg) => leg.venue).sort()).toEqual(["a", "b"]);
    expect(plan.savingsUsd).toBeGreaterThan(0);
  });

  it("gives up when a leg falls under its venue minimum", () => {
    const venues = [
      { venue: "a", book: book([[100, 1], [102, 10]]), takerFee: 0 },
      { venue: "b", book: book([[100.5, 1], [103, 10]]), takerFee: 0, minUsd: 150 },
    ];
    expect(splitExecution("buy", 300, venues)).toBeNull();
  });
});

describe("mergeVenueBooks", () => {
  it("sums sizes per price and keeps each venue's share", () => {
    const merged = mergeVenueBooks(
      [
        { venue: "hl", book: book([[100.04, 1], [100.12, 2]], [[99.96, 1]]) },
        { venue: "lighter", book: book([[100.08, 3]], [[99.91, 2]]) },
      ],
      0.1,
    );
    expect(merged.asks[0]).toEqual({ price: 100.1, size: 4, byVenue: { hl: 1, lighter: 3 } });
    expect(merged.asks[1]).toEqual({ price: 100.2, size: 2, byVenue: { hl: 2 } });
    expect(merged.bids[0]).toEqual({ price: 99.9, size: 3, byVenue: { hl: 1, lighter: 2 } });
    expect(merged.crossed).toBe(false);
  });

  it("flags crossed books across venues", () => {
    const merged = mergeVenueBooks([{ venue: "hl", book: book([[101, 1]], [[100.5, 1]]) }, { venue: "lighter", book: book([[100.4, 1]], [[100, 1]]) }], 0.1);
    expect(merged.crossed).toBe(true);
  });
});
