import { describe, expect, it } from "vitest";
import { carriesRecipient, readAcrossDeposit, readAcrossStatus, readLifiTransfer, readRelayRequest } from "./bridge-points";

const OURS = "0x9fc4e320a181e88644a302d11f1f158ef0699e37";

describe("Relay requests", () => {
  // Shape of a live `/requests/v2?id=` answer (trimmed).
  const request = (over: Record<string, unknown> = {}, fees = [{ recipient: OURS.toUpperCase().replace("0X", "0x"), bps: "20", amount: "6358" }]) => ({
    requests: [{ id: "0x17", status: "success", user: "0xB957bcdf4d453b7d4a61dad758b7127c68e8b346", data: { appFees: fees, metadata: { currencyIn: { amountUsd: "31.79" } } }, ...over }],
  });

  it("counts a finished request that paid our app fee", () => {
    expect(readRelayRequest(request(), OURS)).toEqual({ user: "0xb957bcdf4d453b7d4a61dad758b7127c68e8b346", usd: 31.79, bps: 20 });
  });

  it("refuses unfinished requests and requests without our fee", () => {
    expect(readRelayRequest(request({ status: "pending" }), OURS)).toBeNull();
    expect(readRelayRequest(request({}, [{ recipient: "0x403526c001f7d80dd9d9dce2cb7c46c87ecb657a", bps: "20", amount: "1" }]), OURS)).toBeNull();
    expect(readRelayRequest({ requests: [] }, OURS)).toBeNull();
  });
});

describe("LI.FI transfers", () => {
  const transfer = (over: Record<string, unknown> = {}) => ({ status: "DONE", fromAddress: "0x9452ED6dA616783786c6D8aAF73047ECaD126C57", metadata: { integrator: "angler" }, sending: { amountUSD: "247.9840" }, ...over });

  it("counts a finished transfer with our integrator, Solana senders too", () => {
    expect(readLifiTransfer(transfer(), "angler")).toEqual({ user: "0x9452ed6da616783786c6d8aaf73047ecad126c57", usd: 247.984 });
    expect(readLifiTransfer(transfer({ fromAddress: "BTU7sqiy72ugjUJjUVTWZpYdWdGUqT21J6NJowBJ63ux" }), "angler")?.user).toBe("BTU7sqiy72ugjUJjUVTWZpYdWdGUqT21J6NJowBJ63ux");
  });

  it("refuses other integrators and transfers still on their way", () => {
    expect(readLifiTransfer(transfer({ metadata: { integrator: "jumper.exchange" } }), "angler")).toBeNull();
    expect(readLifiTransfer(transfer({ status: "PENDING" }), "angler")).toBeNull();
  });
});

describe("Across deposits", () => {
  const HASH = "0x920934eb96eeb7ebf7d07d4bed4d6e10281155456aee3a34d8612ad5306e7a44";

  it("reads a filled deposit's origin transaction and what went in", () => {
    expect(readAcrossStatus({ status: "filled", depositTxHash: HASH })).toEqual({ depositTxHash: HASH });
    expect(readAcrossStatus({ status: "pending", depositTxHash: HASH })).toBeNull();
    const deposit = { deposit: { status: "filled", inputToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", inputAmount: "99900000" } };
    expect(readAcrossDeposit(deposit)).toEqual({ inputToken: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", inputAmount: BigInt(99_900_000) });
    expect(readAcrossDeposit({ deposit: { ...deposit.deposit, status: "expired" } })).toBeNull();
  });

  it("finds our recipient in the origin calldata", () => {
    expect(carriesRecipient(`0xabcdef${"1111111111111111111111111111111111111111"}00`, OURS.replace("9fc4", "1111").replace(/./g, (c, i) => (i < 2 ? c : "1")))).toBe(true);
    expect(carriesRecipient("0xabcdef00", OURS)).toBe(false);
    expect(carriesRecipient("0xabcdef00", "not an address")).toBe(false);
  });
});
