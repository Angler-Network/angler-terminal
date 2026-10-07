import { describe, expect, it } from "vitest";
import { baseCandleCount, baseMs, isTokenAddress, pickPool, poolTimeframe, readOhlcv, resampleCandles } from "./pool-candles";

const HOUR = 3_600_000;

describe("poolTimeframe", () => {
  it("uses native GeckoTerminal frames and merges the rest", () => {
    expect(poolTimeframe("1h")).toEqual({ timeframe: "hour", aggregate: 1, factor: 1 });
    expect(poolTimeframe("30m")).toEqual({ timeframe: "minute", aggregate: 15, factor: 2 });
    expect(poolTimeframe("1w")).toEqual({ timeframe: "day", aggregate: 1, factor: 7 });
    expect(baseMs("4h")).toBe(4 * HOUR);
    expect(baseCandleCount("1w", 1000)).toBe(1000);
    expect(baseCandleCount("2h", 3)).toBe(6);
  });
});

describe("readOhlcv", () => {
  it("reads newest-first second rows as oldest-first ms candles", () => {
    // Real shape (cbBTC/USDC on Orca), newest first.
    const body = {
      data: {
        attributes: {
          ohlcv_list: [
            [1791363600, 84040.6, 84321.3, 83670.8, 83671.1, 372358.5],
            [1791360000, 84100, 84200, 83900, 84040.6, 100000],
            ["bad"],
            [1791356400, 0, 1, 1, 1, 1],
          ],
        },
      },
    };
    expect(readOhlcv(body)).toEqual([
      { time: 1791360000_000, open: 84100, high: 84200, low: 83900, close: 84040.6, volume: 100000 },
      { time: 1791363600_000, open: 84040.6, high: 84321.3, low: 83670.8, close: 83671.1, volume: 372358.5 },
    ]);
    expect(readOhlcv({ errors: [{ status: "429" }] })).toEqual([]);
  });
});

describe("resampleCandles", () => {
  it("merges base candles into aligned buckets", () => {
    const candles = [0, 1, 2, 3].map((index) => ({ time: index * HOUR, open: 10 + index, high: 20 + index, low: 5 - index, close: 11 + index, volume: 1 }));
    expect(resampleCandles(candles, HOUR, 2)).toEqual([
      { time: 0, open: 10, high: 21, low: 4, close: 12, volume: 2 },
      { time: 2 * HOUR, open: 12, high: 23, low: 2, close: 14, volume: 2 },
    ]);
    expect(resampleCandles(candles, HOUR, 1)).toBe(candles);
  });

  it("starts a partial first bucket at the aligned time", () => {
    const [first] = resampleCandles([{ time: HOUR, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 }], HOUR, 2);
    expect(first.time).toBe(0);
  });
});

describe("pickPool", () => {
  it("takes the busiest pool", () => {
    const pool = (address: string, name: string, volume: string, reserve: string, dex: string) => ({
      id: `solana_${address}`,
      attributes: { address, name, volume_usd: { h24: volume }, reserve_in_usd: reserve },
      relationships: { dex: { data: { id: dex } } },
    });
    const body = { data: [pool("A", "cbBTC / SOL", "7000000", "10000000", "orca"), pool("B", "cbBTC / USDC", "13000000", "5000000", "orca")] };
    expect(pickPool(body)).toEqual({ address: "B", name: "cbBTC / USDC", dex: "orca" });
    expect(pickPool({ data: [] })).toBeNull();
    expect(pickPool(null)).toBeNull();
  });
});

describe("isTokenAddress", () => {
  it("checks the address format per chain", () => {
    expect(isTokenAddress("solana", "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij")).toBe(true);
    expect(isTokenAddress("solana", "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC")).toBe(false);
    expect(isTokenAddress("robinhood", "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC")).toBe(true);
    expect(isTokenAddress("robinhood", "../etc")).toBe(false);
  });
});
