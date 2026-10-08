import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { asterNonce, encodeParams, signAgentRequest, walletParams, walletTypedData } from "./sign";

describe("Aster signing", () => {
  it("makes unique microsecond-style nonces within a second", () => {
    const at = Date.parse("2026-10-08T12:00:00Z");
    const a = asterNonce(at);
    const b = asterNonce(at + 10);
    expect(b).toBe(a + 1);
    expect(asterNonce(at + 1000)).toBe((at / 1000 + 1) * 1_000_000);
  });

  it("builds the wallet struct from the fields, capitalized, with inferred types", () => {
    const params = walletParams({ agentName: "angler", agentAddress: "0xabc", expired: 1967945395040, canPerpTrade: true, canWithdraw: false }, "0xuser", 42);
    const typed = walletTypedData("ApproveAgent", params);
    expect(typed.domain).toMatchObject({ name: "AsterSignTransaction", version: "1", chainId: 56 });
    expect(typed.types.ApproveAgent).toEqual([
      { name: "AgentName", type: "string" },
      { name: "AgentAddress", type: "string" },
      { name: "Expired", type: "uint256" },
      { name: "CanPerpTrade", type: "bool" },
      { name: "CanWithdraw", type: "bool" },
      { name: "AsterChain", type: "string" },
      { name: "User", type: "string" },
      { name: "Nonce", type: "uint256" },
    ]);
    expect(typed.message.Nonce).toBe(42n);
  });

  it("signs agent requests over the url-encoded parameters", async () => {
    const agent = privateKeyToAccount("0x4fd0a42218f3eae43a6ce26d22544e986139a01e5b34a62db53757ffca81bae1");
    const query = await signAgentRequest(agent, "0xuser", { symbol: "BTCUSDT", type: "MARKET", quantity: "0.001" }, 7);
    const [body, signature] = query.split("&signature=");
    expect(body).toBe(encodeParams({ symbol: "BTCUSDT", type: "MARKET", quantity: "0.001", asterChain: "Mainnet", user: "0xuser", signer: agent.address, nonce: 7 }));
    const recovered = await recoverTypedDataAddress({
      domain: { name: "AsterSignTransaction", version: "1", chainId: 1666, verifyingContract: "0x0000000000000000000000000000000000000000" },
      types: { Message: [{ name: "msg", type: "string" }] },
      primaryType: "Message",
      message: { msg: body },
      signature: signature as `0x${string}`,
    });
    expect(recovered).toBe(agent.address);
  });
});
