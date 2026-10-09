import { describe, expect, it } from "vitest";
import { fastWithdrawMemo } from "./withdraw";

describe("fastWithdrawMemo", () => {
  it("is the payout address then 12 zero bytes", () => {
    expect(fastWithdrawMemo("0xAbCdEf0123456789aBcDeF0123456789AbCdEf01")).toBe("abcdef0123456789abcdef0123456789abcdef01" + "0".repeat(24));
    expect(() => fastWithdrawMemo("0x1234")).toThrow();
  });
});
