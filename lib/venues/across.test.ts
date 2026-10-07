import { describe, expect, it } from "vitest";
import { acrossErrorMessage, acrossFillState, acrossQuoteParams, summarizeAcrossQuote } from "./across";
import { ARBITRUM, ROBINHOOD } from "./deposits";

const wallet = "0x1111111111111111111111111111111111111111";

describe("across", () => {
  it("quotes an exact USDC input into USDG on Robinhood Chain", () => {
    expect(acrossQuoteParams({ from: ARBITRUM, to: ROBINHOOD.mainnet, units: 25_000_000n, depositor: wallet, recipient: wallet })).toEqual({
      tradeType: "exactInput",
      amount: "25000000",
      route: { originChainId: 42161, inputToken: ARBITRUM.usdc, destinationChainId: 4663, outputToken: ROBINHOOD.mainnet.usdc },
      depositor: wallet,
      recipient: wallet,
    });
    expect(acrossQuoteParams({ from: ARBITRUM, to: ROBINHOOD.mainnet, units: 1n, depositor: wallet, recipient: wallet, integratorId: "0x00ab" })).toMatchObject({
      integratorId: "0x00ab",
    });
  });

  it("summarizes a quote and flags a short balance", () => {
    const summary = summarizeAcrossQuote({
      expectedOutputAmount: "24990000",
      minOutputAmount: "24900000",
      expectedFillTime: 2,
      inputAmount: "25000000",
      checks: { balance: { actual: "10000000", expected: "25000000" } },
      fees: { total: { amountUsd: "0.0123" } },
      swapTx: { to: "0x" },
    });
    expect(summary).toEqual({ expectedOut: 24_990_000n, minOut: 24_900_000n, feeUsd: 0.0123, fillSeconds: 2, shortBalance: true, executable: true });
  });

  it("reads fill states and errors", () => {
    expect(acrossFillState("filled")).toBe("filled");
    expect(acrossFillState("refunded")).toBe("failed");
    expect(acrossFillState("pending")).toBe("pending");
    expect(acrossErrorMessage({ type: "AcrossApiError", code: "AMOUNT_TOO_LOW", message: "Sent amount is too low" }, 400)).toBe("The amount is too small for this route.");
    expect(acrossErrorMessage({}, 502)).toBe("Across responded 502.");
  });
});
