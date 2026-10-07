import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { readUniswapServerConfig, withIntegratorFee } = await import("./server");

const recipient = "0x1234567890abcdef1234567890abcdef12345678";

describe("Uniswap server config", () => {
  it("reads the key and the fee", () => {
    expect(readUniswapServerConfig({ UNISWAP_API_KEY: " key ", UNISWAP_FEE_BPS: "25", UNISWAP_FEE_RECIPIENT: recipient })).toEqual({
      apiKey: "key",
      fee: { bips: 25, recipient },
    });
  });

  it("turns a malformed fee off instead of failing quotes", () => {
    const fee = (bps: string, to = recipient) => readUniswapServerConfig({ UNISWAP_API_KEY: "k", UNISWAP_FEE_BPS: bps, UNISWAP_FEE_RECIPIENT: to }).fee;
    expect(fee("501")).toBeNull();
    expect(fee("0")).toBeNull();
    expect(fee("2.555")).toBeNull();
    expect(fee("abc")).toBeNull();
    expect(fee("25", "0x0000000000000000000000000000000000000002")).toBeNull();
    expect(fee("25", "nope")).toBeNull();
    expect(fee("2.5")).toEqual({ bips: 2.5, recipient });
    expect(readUniswapServerConfig({}).apiKey).toBeNull();
  });

  it("replaces any fee the browser sent", () => {
    const sent = { amount: "1", integratorFees: [{ bips: 1, recipient: "0xattacker" }] };
    expect(withIntegratorFee(sent, { bips: 25, recipient })).toEqual({ body: { amount: "1", integratorFees: [{ bips: 25, recipient }] }, headers: {} });
    expect(withIntegratorFee(sent, null).body).toEqual({ amount: "1" });
    expect(withIntegratorFee({}, { bips: 2.5, recipient }).headers).toEqual({ "x-universal-router-version": "2.1.1" });
  });
});
