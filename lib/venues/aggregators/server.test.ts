import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { aggregatorEnabled, kyberExchangeName, readAggregatorConfig } = await import("./server");

describe("aggregator config", () => {
  it("takes one fee for both aggregators and turns a malformed one off", () => {
    const recipient = "0x00000000000000000000000000000000000000a1";
    const config = readAggregatorConfig({ ZEROX_API_KEY: " key ", AGGREGATOR_FEE_BPS: "20", AGGREGATOR_FEE_RECIPIENT: recipient });
    expect(config).toMatchObject({ zeroxKey: "key", odosKey: null, fee: { bps: 20, recipient } });
    expect(aggregatorEnabled("zerox", config)).toBe(true);
    expect(aggregatorEnabled("odos", config)).toBe(false);
    expect(readAggregatorConfig({ AGGREGATOR_FEE_BPS: "500", AGGREGATOR_FEE_RECIPIENT: recipient }).fee).toBeNull();
    expect(readAggregatorConfig({ AGGREGATOR_FEE_BPS: "20", AGGREGATOR_FEE_RECIPIENT: "nope" }).fee).toBeNull();
  });
});

describe("KyberSwap", () => {
  it("is on with a client id and names DEXes like the other sources", () => {
    expect(aggregatorEnabled("kyberswap", readAggregatorConfig({ KYBERSWAP_CLIENT_ID: "angler" }))).toBe(true);
    expect(aggregatorEnabled("kyberswap", readAggregatorConfig({}))).toBe(false);
    expect(kyberExchangeName("pancake-v3")).toBe("Pancake V3");
    expect(kyberExchangeName("uniswap_v4")).toBe("Uniswap V4");
    expect(kyberExchangeName("flux-prop")).toBe("Flux Prop");
    expect(kyberExchangeName("uniswapv3")).toBe("Uniswap V3");
  });
});
