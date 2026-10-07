import { describe, expect, it } from "vitest";
import changes from "./fixtures/llama-percentage.json";
import prices from "./fixtures/llama-prices.json";
import { llamaKey, readLlamaMarkets } from "./llama";

describe("DefiLlama prices", () => {
  it("reads prices, confidence and the 24h change by lowercase key", () => {
    const markets = readLlamaMarkets(prices, changes);
    const weth = markets.get(llamaKey("base", "0x4200000000000000000000000000000000000006"))!;
    expect(weth.price).toBeGreaterThan(100);
    expect(weth.confidence).toBeGreaterThan(0.9);
    expect(weth.change24h).toBeCloseTo(-4.51, 1);
    // Native ETH has a price but no change in this sample.
    const eth = markets.get(llamaKey("ethereum", "0x0000000000000000000000000000000000000000"))!;
    expect(eth.price).toBeGreaterThan(100);
    expect(eth.change24h).toBeUndefined();
    // Mixed-case keys still match.
    expect(markets.get(llamaKey("base", "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"))?.price).toBeGreaterThan(1000);
  });

  it("skips coins without a usable price", () => {
    expect(readLlamaMarkets({ coins: { "base:0x1": { price: 0 }, "base:0x2": { price: "1" } } }).size).toBe(0);
    expect(readLlamaMarkets(null).size).toBe(0);
  });
});
