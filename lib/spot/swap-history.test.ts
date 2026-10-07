import { describe, expect, it } from "vitest";
import { addSwap, costBasis, readSwapHistory, unrealizedPnl, type SwapRecord } from "./swap-history";

const swap = (tx: string, at: number, side: "buy" | "sell", amount: number, usd: number): SwapRecord => ({ tx, at, chain: "solana", token: "T", symbol: "T", side, amount, usd });

describe("swap history", () => {
  it("reads only valid records, newest first, and adds each transaction once", () => {
    const stored = JSON.stringify([swap("a", 1, "buy", 1, 10), { tx: "bad" }, swap("b", 2, "sell", 1, 12)]);
    expect(readSwapHistory(stored).map((record) => record.tx)).toEqual(["b", "a"]);
    expect(readSwapHistory("not json")).toEqual([]);
    const history = addSwap(addSwap([], swap("a", 1, "buy", 1, 10)), swap("a", 1, "buy", 1, 10));
    expect(history).toHaveLength(1);
  });

  it("keeps an average cost and realizes PnL on sells", () => {
    // Buy 10 @ $1, buy 10 @ $2 (avg 1.5), sell 5 for $15 (realized 15 - 7.5 = 7.5).
    const history = [swap("1", 1, "buy", 10, 10), swap("2", 2, "buy", 10, 20), swap("3", 3, "sell", 5, 15)];
    const basis = costBasis(history, "T");
    expect(basis.amount).toBe(15);
    expect(basis.cost).toBeCloseTo(22.5);
    expect(basis.realized).toBeCloseTo(7.5);
    // Held 15 at $2: +0.5 each.
    expect(unrealizedPnl(basis, 15, 2)).toMatchObject({ pnl: 7.5, average: 1.5, partial: false });
    // Holding more than was bought here: only the known part is valued, and it says so.
    expect(unrealizedPnl(basis, 20, 2)).toMatchObject({ pnl: 7.5, partial: true });
    expect(unrealizedPnl(costBasis([], "T"), 5, 2)).toBeNull();
  });

  it("ignores sells of tokens that weren't bought here", () => {
    const basis = costBasis([swap("1", 1, "sell", 5, 50), swap("2", 2, "buy", 2, 4)], "T");
    expect(basis).toEqual({ amount: 2, cost: 4, realized: 0 });
  });
});
