import { describe, expect, it } from "vitest";
import { orderOutcome, permitPrimaryType, permitTypes, readUniswapQuote, readUniswapTx, settledAmounts, uniswapErrorMessage } from "./quote";

const swapper = "0x00000000000000000000000000000000000000a1";
const feeRecipient = "0x00000000000000000000000000000000000000b2";

const classic = {
  routing: "CLASSIC",
  permitData: {
    domain: { name: "Permit2", chainId: 4663, verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
    types: {
      PermitSingle: [
        { name: "details", type: "PermitDetails" },
        { name: "spender", type: "address" },
        { name: "sigDeadline", type: "uint256" },
      ],
      PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
      ],
    },
    values: { details: {}, spender: "0x8876789976decbfcbbbe364623c63652db8c0904", sigDeadline: "1" },
  },
  quote: {
    input: { amount: "100000000", token: "0xusdg" },
    output: { amount: "551000000000000000", token: "0xnvda", minimumAmount: "1" },
    swapper,
    priceImpact: -0.12,
    gasFeeUSD: "0.0031",
    route: [[{ type: "v4-pool" }, { type: "v3-pool" }], [{ type: "v4-pool" }]],
    aggregatedOutputs: [
      { token: "0xnvda", amount: "550000000000000000", recipient: swapper, bps: 9975, minAmount: "547000000000000000" },
      { token: "0xnvda", amount: "1000000000000000", recipient: feeRecipient, bps: 25, minAmount: "990000000000000", fee: "INTEGRATOR" },
    ],
  },
};

describe("Uniswap quotes", () => {
  it("reads a classic quote net of our fee", () => {
    const quote = readUniswapQuote(classic, 1)!;
    expect(quote.settle).toBe("tx");
    expect(quote.inAmount).toBe(100000000n);
    // The swapper's own output, not the gross amount that includes the fee.
    expect(quote.outAmount).toBe(550000000000000000n);
    expect(quote.minOutAmount).toBe(547000000000000000n);
    expect(quote.feeAmount).toBe(1000000000000000n);
    expect(quote.feeBps).toBe(25);
    expect(quote.priceImpactPct).toBeCloseTo(0.12);
    expect(quote.gasFeeUsd).toBeCloseTo(0.0031);
    expect(quote.route).toEqual(["Uniswap V4", "Uniswap V3"]);
    expect(quote.raw).toBe(classic.quote);
    expect(quote.fetchedAt).toBe(1);
  });

  it("reads a UniswapX order as gasless", () => {
    const quote = readUniswapQuote({
      routing: "DUTCH_V3",
      permitData: classic.permitData,
      quote: { encodedOrder: "0x", orderId: "0x1", input: { amount: "5000000" }, output: { amount: "9" }, expectedAmountOut: "8" },
    })!;
    expect(quote.settle).toBe("order");
    expect(quote.outAmount).toBe(8n);
    expect(quote.gasFeeUsd).toBe(0);
    expect(quote.route).toEqual(["UniswapX"]);
  });

  it("refuses routings the terminal can't execute", () => {
    expect(readUniswapQuote({ routing: "CHAINED", quote: { input: { amount: "1" }, output: { amount: "1" } } })).toBeNull();
    expect(readUniswapQuote({ routing: "BRIDGE", quote: { input: { amount: "1" }, output: { amount: "1" } } })).toBeNull();
    expect(readUniswapQuote({ routing: "CLASSIC", quote: { input: { amount: "1" }, output: { amount: "0" } } })).toBeNull();
    expect(readUniswapQuote(null)).toBeNull();
  });

  it("finds the permit's primary type and drops the domain type", () => {
    expect(permitPrimaryType(classic.permitData.types)).toBe("PermitSingle");
    const withDomain = { ...classic.permitData.types, EIP712Domain: [{ name: "name", type: "string" }] };
    expect(permitPrimaryType(withDomain)).toBe("PermitSingle");
    expect(Object.keys(permitTypes(withDomain))).toEqual(["PermitSingle", "PermitDetails"]);
  });

  it("checks transactions before they reach the wallet", () => {
    const to = "0x8876789976decbfcbbbe364623c63652db8c0904";
    expect(readUniswapTx({ to, data: "0x3593564c", value: "0", gasLimit: "210000" })).toEqual({ to, data: "0x3593564c", value: 0n, gas: 210000n });
    expect(readUniswapTx({ to, data: "0x", value: "0" })).toBeNull();
    expect(readUniswapTx({ to, data: "", value: "0" })).toBeNull();
    expect(readUniswapTx({ to: "0x12", data: "0xab", value: "0" })).toBeNull();
    expect(readUniswapTx({ to, data: "0xab", value: "-1" })).toBeNull();
    expect(readUniswapTx(null)).toBeNull();
  });

  it("maps order states and settled amounts", () => {
    expect(orderOutcome("open")).toBe("pending");
    expect(orderOutcome("unverified")).toBe("pending");
    expect(orderOutcome("filled")).toBe("filled");
    expect(orderOutcome("expired")).toBe("failed");
    expect(settledAmounts({ settledAmounts: [{ amountIn: "5", amountOut: "7" }, { amountIn: "1", amountOut: "2" }] })).toEqual({ amountIn: 6n, amountOut: 9n });
    expect(settledAmounts({ settledAmounts: [] })).toBeNull();
  });

  it("turns API errors into readable text", () => {
    expect(uniswapErrorMessage("QuoteNotFound", "No quotes available", 404)).toContain("no route");
    expect(uniswapErrorMessage(undefined, undefined, 429)).toContain("rate limiting");
    expect(uniswapErrorMessage("RequestValidationError", "\"amount\" is required", 400)).toBe('Uniswap: "amount" is required');
  });
});
