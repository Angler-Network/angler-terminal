import { describe, expect, it } from "vitest";
import type { SpotToken } from "../types";
import { MESSAGES } from "./errors";
import { toSpotQuote } from "./quote";

const usdc: SpotToken = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6, isVerified: true };
const sol: SpotToken = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Wrapped SOL", decimals: 9, isVerified: true };
const TAKER = "Taker1111111111111111111111111111111111111";

describe("toSpotQuote", () => {
  it("maps amounts, minimum received, impact and fees", () => {
    const quote = toSpotQuote(
      {
        requestId: "r1",
        inAmount: "2000000",
        outAmount: "13300000",
        otherAmountThreshold: "13200000",
        slippageBps: 50,
        priceImpact: -0.05,
        feeBps: 52,
        feeMint: usdc.mint,
        taker: TAKER,
        signatureFeeLamports: 5000,
        signatureFeePayer: TAKER,
        prioritizationFeeLamports: 10000,
        prioritizationFeePayer: "SomeoneElse111111111111111111111111111111111",
        rentFeeLamports: 2039280,
        router: "metis",
        transaction: "AQID",
      },
      usdc,
      sol,
      1,
    );
    expect(quote).toMatchObject({
      requestId: "r1",
      inAmount: 2_000_000n,
      outAmount: 13_300_000n,
      minOutAmount: 13_200_000n,
      priceImpactPct: -0.05,
      feeBps: 52,
      networkFeeLamports: 5000 + 2039280,
      transaction: "AQID",
      error: undefined,
    });
  });

  it("keeps the price but blocks execution when the transaction couldn't be built", () => {
    const quote = toSpotQuote({ requestId: "r2", outAmount: "1", transaction: "", router: "metis", errorCode: 2, errorMessage: "x" }, usdc, sol);
    expect(quote.transaction).toBeNull();
    expect(quote.error).toBe(MESSAGES.insufficientSol);
  });

  it("treats a missing transaction without taker as a price-only quote", () => {
    const quote = toSpotQuote({ requestId: "r3", outAmount: "1", transaction: null }, usdc, sol);
    expect(quote.transaction).toBeNull();
    expect(quote.error).toBeUndefined();
  });
});
