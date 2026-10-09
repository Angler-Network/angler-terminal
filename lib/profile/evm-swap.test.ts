import { describe, expect, it } from "vitest";
import { NATIVE, TRANSFER_TOPIC, readEvmSwap, type EvmReceipt, type EvmTx } from "./evm-swap";

const WALLET = "0x1111111111111111111111111111111111111111";
const FEE = "0x2222222222222222222222222222222222222222";
const ROUTER = "0x3333333333333333333333333333333333333333";
const USDC = "0x4444444444444444444444444444444444444444";
const TOKEN = "0x5555555555555555555555555555555555555555";
const topic = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;
const transfer = (token: string, from: string, to: string, amount: bigint) => ({ address: token, topics: [TRANSFER_TOPIC, topic(from), topic(to)], data: `0x${amount.toString(16).padStart(64, "0")}` });
const tx = (over: Partial<EvmTx> = {}): EvmTx => ({ from: WALLET, to: ROUTER, input: `0xdeadbeef${FEE.slice(2)}`, value: "0x0", blockNumber: "0x10", ...over });

describe("readEvmSwap", () => {
  it("reads a token swap that carries our fee recipient in the calldata", () => {
    const receipt: EvmReceipt = { status: "0x1", logs: [transfer(USDC, WALLET, ROUTER, BigInt(100_000_000)), transfer(TOKEN, ROUTER, WALLET, BigInt(5) * BigInt(10) ** BigInt(18))] };
    expect(readEvmSwap(tx(), receipt, WALLET, [FEE])).toMatchObject({
      recipient: FEE,
      input: { token: USDC, amount: BigInt(100_000_000) },
      output: { token: TOKEN, amount: BigInt(5) * BigInt(10) ** BigInt(18) },
    });
  });

  it("takes the native value as the input and finds a fee paid as a transfer (Arcus)", () => {
    const receipt: EvmReceipt = { status: "0x1", logs: [transfer(TOKEN, ROUTER, FEE, BigInt(1)), transfer(TOKEN, ROUTER, WALLET, BigInt(9))] };
    const swap = readEvmSwap(tx({ input: "0xdeadbeef", value: "0xde0b6b3a7640000" }), receipt, WALLET.toUpperCase().replace("0X", "0x"), [FEE]);
    expect(swap?.input).toEqual({ token: NATIVE, amount: BigInt("1000000000000000000") });
    // The fee transfer isn't a leg; the swap's own legs are.
    expect(swap?.legs).toEqual([{ token: TOKEN, amount: BigInt(9) }]);
  });

  it("counts a gasless fill sent by someone else when the wallet's tokens moved", () => {
    const receipt: EvmReceipt = { status: "0x1", logs: [transfer(USDC, WALLET, ROUTER, BigInt(50_000_000))] };
    expect(readEvmSwap(tx({ from: ROUTER }), receipt, WALLET, [FEE])?.input).toEqual({ token: USDC, amount: BigInt(50_000_000) });
  });

  it("refuses failed swaps, swaps without our fee and swaps the wallet had no part in", () => {
    const logs = [transfer(USDC, WALLET, ROUTER, BigInt(1))];
    expect(readEvmSwap(tx(), { status: "0x0", logs }, WALLET, [FEE])).toBeNull();
    expect(readEvmSwap(tx({ input: "0xdeadbeef" }), { status: "0x1", logs }, WALLET, [FEE])).toBeNull();
    expect(readEvmSwap(tx({ from: ROUTER }), { status: "0x1", logs: [transfer(USDC, TOKEN, ROUTER, BigInt(1))] }, WALLET, [FEE])).toBeNull();
    expect(readEvmSwap(tx(), { status: "0x1", logs }, WALLET, [NATIVE, "not an address"])).toBeNull();
  });
});
