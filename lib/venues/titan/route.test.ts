import { describe, expect, it } from "vitest";
import sample from "./fixtures/quote-sample.json";
import { readTitanRoute, titanErrorMessage } from "./route";

// Shape from the Portal quickstart (no live key in tests).
describe("readTitanRoute", () => {
  it("takes the expected winner with its lookup tables and slippage floor", () => {
    const route = readTitanRoute(sample)!;
    expect(route.provider).toBe("Titan-DART");
    expect(route.outAmount).toBe(995_000_000n);
    expect(route.minOutAmount).toBe(990_025_000n);
    expect(route.lookupTables).toEqual([{ key: "9Re4PV8SstkAFveSuVckncTJakQVS8aT3z8uZvWRY4QA", addresses: ["So11111111111111111111111111111111111111112"] }]);
    expect(route.computeUnitsSafe).toBe(1_400_000);
    // $100 in, 0.995 SOL at $100 out.
    expect(route.priceImpactPct).toBeCloseTo(0.5, 5);
  });

  it("falls back to the best output and rejects empty quotes", () => {
    const { metadata: _metadata, ...withoutWinner } = sample;
    expect(readTitanRoute(withoutWinner)?.provider).toBe("Titan-DART");
    expect(readTitanRoute({ quotes: {} })).toBeNull();
  });

  it("maps errors", () => {
    expect(titanErrorMessage(404, { code: -7 })).toMatch(/no route/);
    expect(titanErrorMessage(429, { error: { code: "rate_limited" } })).toMatch(/rate limiting/);
  });
});
