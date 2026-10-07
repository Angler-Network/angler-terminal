import { describe, expect, it } from "vitest";
import { uniswapOnRobinhood } from "./robinhood-sources";

describe("Robinhood Chain swap sources", () => {
  it("only offers Uniswap on mainnet", () => {
    expect(uniswapOnRobinhood(true, "mainnet")).toBe(true);
    expect(uniswapOnRobinhood(true, "testnet")).toBe(false);
    expect(uniswapOnRobinhood(false, "mainnet")).toBe(false);
  });
});
