import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { readRelayServerConfig, withRelayFee } = await import("./relay-server");

const recipient = "0x1234567890abcdef1234567890abcdef12345678";

describe("Relay server config", () => {
  it("adds our app fee and drops the browser's", () => {
    const config = readRelayServerConfig({ RELAY_FEE_BPS: "10", RELAY_FEE_RECIPIENT: recipient });
    expect(config).toEqual({ apiKey: null, fee: { recipient, fee: "10" } });
    expect(withRelayFee({ amount: "1", appFees: [{ recipient: "0xattacker", fee: "500" }], referrer: "x" }, config)).toEqual({
      amount: "1",
      appFees: [{ recipient, fee: "10" }],
    });
  });

  it("names us as referrer only with a key, and turns a bad fee off", () => {
    expect(withRelayFee({}, readRelayServerConfig({ RELAY_API_KEY: "k" }))).toEqual({ referrer: "angler.network" });
    expect(readRelayServerConfig({ RELAY_FEE_BPS: "2.5", RELAY_FEE_RECIPIENT: recipient }).fee).toBeNull();
    expect(readRelayServerConfig({ RELAY_FEE_BPS: "600", RELAY_FEE_RECIPIENT: recipient }).fee).toBeNull();
    expect(readRelayServerConfig({ RELAY_FEE_BPS: "10", RELAY_FEE_RECIPIENT: "nope" }).fee).toBeNull();
  });
});
