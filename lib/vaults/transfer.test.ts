import { describe, expect, it } from "vitest";
import { hlVaultUsd, hlWithdrawUsd, isInAppVault, lighterShares, vaultTransferError } from "./transfer";

const NOW = 1_800_000_000_000;
const hl = { venue: "hyperliquid" as const, open: true, minDeposit: null, sharePrice: undefined };
const pool = { venue: "lighter" as const, open: true, minDeposit: null, sharePrice: 0.004 };

describe("vault transfers", () => {
  it("runs Hyperliquid and Lighter in the terminal, Orderly on its own page", () => {
    expect(isInAppVault({ venue: "hyperliquid" })).toBe(true);
    expect(isInAppVault({ venue: "lighterRh" })).toBe(true);
    expect(isInAppVault({ venue: "orderly" })).toBe(false);
  });

  it("sends Hyperliquid micro-dollars, rounded down, and the whole stake near all of it", () => {
    expect(hlVaultUsd(12.3456789)).toBe(12_345_678);
    expect(hlVaultUsd(0.1 + 0.2)).toBe(300_000);
    expect(hlWithdrawUsd(50, 100)).toBe(50_000_000);
    expect(hlWithdrawUsd(99.8, 100.004)).toBe(100_004_000);
  });

  it("prices Lighter shares and never burns more than held", () => {
    expect(lighterShares("deposit", 100, 0.004)).toBe(25_000);
    expect(lighterShares("withdraw", 40, 0.004, 25_000)).toBe(10_000);
    expect(lighterShares("withdraw", 99.9, 0.004, 25_000)).toBe(25_000);
    expect(lighterShares("withdraw", 500, 0.004, 25_000)).toBe(25_000);
    expect(lighterShares("deposit", 0, 0.004)).toBe(0);
  });

  it("checks deposits against the vault and the free margin", () => {
    const check = (amount: number, vault: Parameters<typeof vaultTransferError>[0]["vault"] = hl, available: number | null = 100) =>
      vaultTransferError({ mode: "deposit", amount, available, vault, stake: null, now: NOW });
    expect(check(0)).toBeNull();
    expect(check(50)).toBeNull();
    expect(check(150)).toMatch(/free to deposit/);
    expect(check(50, { ...hl, open: false })).toMatch(/isn't taking/);
    expect(check(50, { ...hl, minDeposit: 100 })).toMatch(/minimum/);
    expect(check(50, pool)).toBeNull();
    expect(check(50, { ...pool, sharePrice: undefined })).toMatch(/share price/);
    expect(check(0.001, pool)).toMatch(/one pool share/);
  });

  it("checks withdrawals against the stake and its lock", () => {
    const check = (amount: number, stake: { value: number | null; lockedUntil: number | null } | null) =>
      vaultTransferError({ mode: "withdraw", amount, available: null, vault: hl, stake, now: NOW });
    expect(check(10, null)).toMatch(/nothing/);
    expect(check(10, { value: 100, lockedUntil: null })).toBeNull();
    expect(check(101, { value: 100, lockedUntil: null })).toMatch(/More than you have/);
    expect(check(10, { value: 100, lockedUntil: NOW + 1000 })).toMatch(/Locked until/);
  });
});
