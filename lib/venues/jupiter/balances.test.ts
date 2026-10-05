import { describe, expect, it } from "vitest";
import { spendableBalance, sumTokenAccounts } from "./balances";
import { WSOL_MINT } from "./config";

const account = (amount: string) => ({ account: { data: { parsed: { info: { tokenAmount: { amount } } } } } });

describe("balances", () => {
  it("sums raw amounts across token accounts", () => {
    expect(sumTokenAccounts([account("1500000"), account("500000")])).toBe(2_000_000n);
    expect(sumTokenAccounts([])).toBe(0n);
  });

  it("counts native SOL as spendable SOL", () => {
    expect(spendableBalance(WSOL_MINT, { [WSOL_MINT]: 10n }, 100n)).toBe(110n);
    expect(spendableBalance("Mint", { Mint: 7n }, 100n)).toBe(7n);
  });
});
