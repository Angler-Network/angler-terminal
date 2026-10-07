import { describe, expect, it } from "vitest";
import { evmRef, evmSwapChain, isEvmRef, isNativeToken, parseEvmRef, wrappedNative } from "./chains";

describe("EVM swap chains", () => {
  it("round-trips token refs and refuses unknown chains", () => {
    const ref = evmRef(8453, "0x532f27101965dd16442E59d40670FaF5eBB142E4");
    expect(parseEvmRef(ref)?.chain.name).toBe("Base");
    expect(parseEvmRef(ref)?.address).toBe("0x532f27101965dd16442E59d40670FaF5eBB142E4");
    expect(parseEvmRef("evm:56:0x532f27101965dd16442E59d40670FaF5eBB142E4")).toBeNull();
    expect(parseEvmRef("So11111111111111111111111111111111111111112")).toBeNull();
    expect(isEvmRef(ref)).toBe(true);
    expect(isEvmRef("So11111111111111111111111111111111111111112")).toBe(false);
  });

  it("pays with USDC first on every chain", () => {
    for (const id of [1, 8453, 42161]) {
      expect(evmSwapChain(id)?.pay[0].symbol).toBe("USDC");
      expect(evmSwapChain(id)?.pay.some((token) => isNativeToken(token.address))).toBe(true);
      expect(wrappedNative(evmSwapChain(id)!).symbol).toBe("WETH");
    }
  });
});
