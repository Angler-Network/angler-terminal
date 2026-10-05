import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { readArcusServerConfig } = await import("./server");

describe("Arcus server config", () => {
  it("sends a builder fee only with a partner key", () => {
    expect(readArcusServerConfig({ ARCUS_BUILDER_FEE_BPS: "10" })).toMatchObject({ apiKey: null, builderFeeBps: null, network: "testnet" });
    expect(readArcusServerConfig({ ARCUS_API_KEY: "k", ARCUS_BUILDER_FEE_BPS: "10", NEXT_PUBLIC_ARCUS_NETWORK: "mainnet" })).toMatchObject({
      builderFeeBps: 10,
      network: "mainnet",
    });
    expect(readArcusServerConfig({ ARCUS_API_KEY: "k", ARCUS_BUILDER_FEE_BPS: "abc" }).builderFeeBps).toBeNull();
  });
});
