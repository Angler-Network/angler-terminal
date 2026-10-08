import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { aggregatorEnabled, readAggregatorConfig } = await import("./server");

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
