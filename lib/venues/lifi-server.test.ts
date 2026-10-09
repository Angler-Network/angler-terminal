import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { lifiQuoteQuery, readLifiServerConfig } = await import("./lifi-server");

const base = "fromChain=42161&toChain=8453&fromToken=0xa&toToken=0xb&fromAmount=5&fromAddress=0xc&toAddress=0xd";

describe("LI.FI server config", () => {
  it("adds our integrator and fee, drops the browser's", () => {
    const config = readLifiServerConfig({ LIFI_INTEGRATOR: "angler", LIFI_FEE_BPS: "20" });
    expect(config).toEqual({ apiKey: null, integrator: "angler", fee: "0.002" });
    const query = lifiQuoteQuery(new URLSearchParams(`${base}&fee=0.5&integrator=evil&denyBridges=all`), config)!;
    expect(query.get("fee")).toBe("0.002");
    expect(query.get("integrator")).toBe("angler");
    expect(query.has("denyBridges")).toBe(false);
  });

  it("passes a short list of bridges to leave out (a second route), nothing else", () => {
    const config = readLifiServerConfig({});
    expect(lifiQuoteQuery(new URLSearchParams(`${base}&denyBridges=relaydepository`), config)!.get("denyBridges")).toBe("relaydepository");
    expect(lifiQuoteQuery(new URLSearchParams(`${base}&denyBridges=mayan,across`), config)!.get("denyBridges")).toBe("mayan,across");
    expect(lifiQuoteQuery(new URLSearchParams(`${base}&denyBridges=relay,all`), config)!.has("denyBridges")).toBe(false);
    expect(lifiQuoteQuery(new URLSearchParams(`${base}&denyBridges=a,b,c,d,e,f`), config)!.has("denyBridges")).toBe(false);
    expect(lifiQuoteQuery(new URLSearchParams(`${base}&allowBridges=evil`), config)!.has("allowBridges")).toBe(false);
  });

  it("charges nothing without an integrator or with a bad fee, and needs every parameter", () => {
    expect(readLifiServerConfig({ LIFI_FEE_BPS: "20" }).fee).toBeNull();
    expect(readLifiServerConfig({ LIFI_INTEGRATOR: "angler", LIFI_FEE_BPS: "2.5" }).fee).toBeNull();
    expect(readLifiServerConfig({ LIFI_INTEGRATOR: "angler", LIFI_FEE_BPS: "400" }).fee).toBeNull();
    expect(lifiQuoteQuery(new URLSearchParams(base), readLifiServerConfig({}))!.has("fee")).toBe(false);
    expect(lifiQuoteQuery(new URLSearchParams("fromChain=1"), readLifiServerConfig({}))).toBeNull();
  });
});
