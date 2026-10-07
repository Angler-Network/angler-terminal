import { describe, expect, it } from "vitest";
import quote from "./fixtures/relay-quote-arb-base.json";
import { ARBITRUM, BASE } from "./deposits";
import { readRelayQuote, relayErrorMessage, relayFillState, relayQuoteBody } from "./relay";

const wallet = "0x000000000000000000000000000000000000dEaD";

describe("Relay", () => {
  it("builds an exact-input quote request for a bridge leg", () => {
    expect(relayQuoteBody({ from: ARBITRUM, to: BASE, units: 50_000_000n, depositor: wallet, recipient: wallet })).toMatchObject({
      user: wallet,
      recipient: wallet,
      originChainId: 42161,
      destinationChainId: 8453,
      originCurrency: ARBITRUM.usdc,
      destinationCurrency: BASE.usdc,
      amount: "50000000",
      tradeType: "EXACT_INPUT",
    });
  });

  it("reads a live quote: approval + deposit on the origin chain", () => {
    const read = readRelayQuote(quote, 42161)!;
    expect(read.executable).toBe(true);
    expect(read.requestId).toMatch(/^0x/);
    expect(read.txs.map((tx) => tx.data.slice(0, 10))).toEqual(["0x095ea7b3", "0xe8017952"]);
    expect(read.expectedOut).toBe(49923948n);
    expect(read.minOut).toBe(48925470n);
    expect(read.feeUsd).toBeCloseTo(0.076, 3);
    expect(read.fillSeconds).toBe(2);
  });

  it("isn't executable when a transaction is for another chain or missing", () => {
    expect(readRelayQuote(quote, 8453)?.executable).toBe(false);
    expect(readRelayQuote({ ...quote, steps: [] }, 42161)?.executable).toBe(false);
    expect(readRelayQuote({}, 42161)).toBeNull();
  });

  it("maps request states and errors", () => {
    expect(relayFillState("success")).toBe("filled");
    expect(relayFillState("refund")).toBe("failed");
    expect(relayFillState("waiting")).toBe("pending");
    expect(relayErrorMessage({ errorCode: "AMOUNT_TOO_LOW", message: "x" }, 400)).toContain("too small");
    expect(relayErrorMessage({}, 500)).toBe("Relay responded 500.");
  });
});
