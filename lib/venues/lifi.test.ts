import { describe, expect, it } from "vitest";
import evmQuote from "./fixtures/lifi-quote-evm.json";
import solanaQuote from "./fixtures/lifi-quote-solana.json";
import { LIFI_SOLANA_CHAIN, lifiErrorMessage, lifiFillState, lifiQuoteParams, readLifiQuote } from "./lifi";

describe("LI.FI quotes", () => {
  it("reads an EVM route: output, approval, one transaction on the origin chain", () => {
    const quote = readLifiQuote(evmQuote, 42161)!;
    expect(quote).toMatchObject({ tool: "across", toChainId: 8453, expectedOut: 19_944_486n, minOut: 19_944_486n, fillSeconds: 1, executable: true });
    expect(quote.approval).toEqual({ token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", spender: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE" });
    expect(quote.tx).toMatchObject({ kind: "evm", chainId: 42161, to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", value: 0n, gas: 0x2ae8ddn });
    expect(quote.feeUsd).toBeCloseTo(0.1092, 4);
  });

  it("refuses a transaction for another chain", () => {
    expect(readLifiQuote(evmQuote, 8453)).toMatchObject({ tx: null, approval: null, executable: false });
  });

  it("reads a Solana route as a base64 transaction, no approval", () => {
    const quote = readLifiQuote(solanaQuote, LIFI_SOLANA_CHAIN)!;
    expect(quote.tx?.kind).toBe("solana");
    expect(quote).toMatchObject({ approval: null, expectedOut: 19_941_710n, minOut: 19_921_768n, executable: true });
  });

  it("builds the query without integrator or fee", () => {
    const params = lifiQuoteParams({ fromChain: 42161, toChain: 8453, fromToken: "0xa", toToken: "0xb", fromAmount: 5n, fromAddress: "0xc", toAddress: "0xd", slippageBps: 50 });
    expect(Object.fromEntries(params)).toEqual({ fromChain: "42161", toChain: "8453", fromToken: "0xa", toToken: "0xb", fromAmount: "5", fromAddress: "0xc", toAddress: "0xd", slippage: "0.005" });
  });
});

describe("LI.FI status", () => {
  it("maps statuses", () => {
    expect(lifiFillState({ status: "DONE", substatus: "COMPLETED" })).toBe("filled");
    expect(lifiFillState({ status: "DONE", substatus: "PARTIAL" })).toBe("filled");
    expect(lifiFillState({ status: "DONE", substatus: "REFUNDED" })).toBe("failed");
    expect(lifiFillState({ status: "FAILED" })).toBe("failed");
    expect(lifiFillState({ status: "NOT_FOUND" })).toBe("pending");
    expect(lifiFillState({ status: "PENDING", substatus: "WAIT_DESTINATION_TRANSACTION" })).toBe("pending");
  });

  it("explains errors", () => {
    expect(lifiErrorMessage({ message: "No available quotes for the requested transfer", code: 1002 }, 404)).toMatch(/no route/);
    expect(lifiErrorMessage({}, 429)).toMatch(/busy/);
  });
});
