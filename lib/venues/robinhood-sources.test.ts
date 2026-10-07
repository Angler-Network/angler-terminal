import { describe, expect, it } from "vitest";
import { uniswapOnRobinhood, orderRobinhoodQuotes } from "./robinhood-sources";

describe("Robinhood Chain swap sources", () => {
  it("only offers Uniswap on mainnet", () => {
    expect(uniswapOnRobinhood(true, "mainnet")).toBe(true);
    expect(uniswapOnRobinhood(true, "testnet")).toBe(false);
    expect(uniswapOnRobinhood(false, "mainnet")).toBe(false);
  });
});

describe("ordering Robinhood quotes", () => {
  const quotes = (arcus: bigint | null, uniswap: bigint | null) => [
    { source: "uniswap" as const, out: uniswap },
    { source: "arcus" as const, out: arcus },
  ];
  const leader = (list: Array<{ source: string }>) => list[0].source;

  it("takes the larger output, Arcus on a tie", () => {
    expect(leader(orderRobinhoodQuotes(quotes(1000n, 1001n), false))).toBe("uniswap");
    expect(leader(orderRobinhoodQuotes(quotes(1000n, 1000n), false))).toBe("arcus");
    expect(leader(orderRobinhoodQuotes(quotes(null, 900n), false))).toBe("uniswap");
  });

  it("keeps Arcus first when preferred unless Uniswap pays over 0.5% more", () => {
    expect(leader(orderRobinhoodQuotes(quotes(10_000n, 10_050n), true))).toBe("arcus");
    expect(leader(orderRobinhoodQuotes(quotes(10_000n, 10_051n), true))).toBe("uniswap");
    expect(leader(orderRobinhoodQuotes(quotes(null, 10_000n), true))).toBe("uniswap");
  });
});
