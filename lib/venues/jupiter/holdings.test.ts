import { describe, expect, it } from "vitest";
import { WSOL_MINT } from "./config";
import { buildHoldings, holdingsValue, rawAmountsByMint } from "./holdings";

const account = (mint: string, amount: string) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount } } } } } });

describe("spot holdings", () => {
  it("sums token accounts per mint and drops empty ones", () => {
    const amounts = rawAmountsByMint([account("A", "5"), account("A", "7"), account("B", "0"), account("C", "x")]);
    expect([...amounts]).toEqual([["A", 12n]]);
  });

  it("values tokens, merges native SOL into SOL, hides unknown and unpriced unverified tokens", () => {
    const amounts = new Map([
      [WSOL_MINT, 500_000_000n],
      ["USDC", 25_000_000n],
      ["SPAM", 1_000n],
      ["UNKNOWN", 9n],
    ]);
    const { holdings, hidden } = buildHoldings(amounts, 1_500_000_000n, [
      { id: WSOL_MINT, symbol: "wSOL", decimals: 9, usdPrice: 100, isVerified: true },
      { id: "USDC", symbol: "USDC", name: "USD Coin", decimals: 6, usdPrice: 1, isVerified: true, icon: "u.png" },
      { id: "SPAM", symbol: "FREE", decimals: 0, isVerified: false },
    ]);
    expect(hidden).toBe(2);
    expect(holdings.map((holding) => [holding.symbol, holding.amount, holding.usd])).toEqual([
      ["SOL", 2, 200],
      ["USDC", 25, 25],
    ]);
    expect(holdingsValue(holdings)).toBe(225);
  });
});
