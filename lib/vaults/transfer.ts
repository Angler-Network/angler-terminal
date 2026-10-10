import type { VaultStake } from "./parse";
import type { VaultRow } from "./types";

/**
 * Vault deposits and withdrawals done in the terminal (Hyperliquid vaults, Lighter and Lighter RH public pools). Pure:
 * the vault window checks the amount with it and turns it into what each venue takes. Hyperliquid moves USD
 * (`vaultTransfer`, micro-dollars) from or to the perp margin; Lighter mints or burns pool shares priced at the pool's
 * value over its shares. No fee rides on either, so they earn no points.
 */

export type VaultTransferMode = "deposit" | "withdraw";

/** Venues whose vaults the terminal deposits into itself; the rest open the venue's own page. */
export const IN_APP_VAULT_VENUES = ["hyperliquid", "lighter", "lighterRh"] as const;
export type InAppVaultVenue = (typeof IN_APP_VAULT_VENUES)[number];

export function isInAppVault(row: Pick<VaultRow, "venue">): row is VaultRow & { venue: InAppVaultVenue } {
  return (IN_APP_VAULT_VENUES as readonly string[]).includes(row.venue);
}

/** Hyperliquid's `usd`: dollars × 1e6, rounded down so a deposit never asks for more than typed. */
export function hlVaultUsd(amount: number) {
  return Math.floor(amount * 1e6 + 1e-6);
}

/** Withdrawing at least this share of the stake takes all of it (its value moves between reading and sending). */
const ALL_SHARE = 0.995;

/**
 * Pool shares for a Lighter deposit or withdrawal of `amount` dollars at `sharePrice`. A withdrawal near the whole stake
 * burns every share held; nothing is ever asked beyond what's held.
 */
export function lighterShares(mode: VaultTransferMode, amount: number, sharePrice: number, held = 0) {
  if (!(amount > 0) || !(sharePrice > 0)) return 0;
  const shares = Math.floor(amount / sharePrice + 1e-9);
  if (mode === "deposit") return shares;
  if (held > 0 && amount >= held * sharePrice * ALL_SHARE) return held;
  return Math.min(shares, held);
}

/** Hyperliquid withdrawal in micro-dollars: the whole stake when the amount is (nearly) all of it. */
export function hlWithdrawUsd(amount: number, stakeValue: number) {
  return amount >= stakeValue * ALL_SHARE ? hlVaultUsd(stakeValue) : hlVaultUsd(amount);
}

/** Why the amount can't go through, or null. `available` is the perp margin free to deposit. */
export function vaultTransferError(input: {
  mode: VaultTransferMode;
  amount: number;
  available: number | null;
  vault: Pick<VaultRow, "open" | "minDeposit" | "sharePrice" | "venue">;
  stake: Pick<VaultStake, "value" | "lockedUntil"> | null;
  now: number;
}): string | null {
  const { mode, amount, available, vault, stake, now } = input;
  if (!(amount > 0)) return null;
  if (mode === "deposit") {
    if (!vault.open) return "This vault isn't taking deposits right now.";
    if (vault.minDeposit && amount < vault.minDeposit) return `The minimum deposit is $${vault.minDeposit}.`;
    if (available !== null && amount > available + 1e-6) return "More than the margin free to deposit.";
  } else {
    if (!stake || !stake.value) return "You have nothing in this vault.";
    if (stake.lockedUntil && stake.lockedUntil > now) return `Locked until ${new Date(stake.lockedUntil).toLocaleString()}.`;
    if (amount > stake.value * 1.0001) return "More than you have in this vault.";
  }
  if (vault.venue !== "hyperliquid") {
    if (!vault.sharePrice) return "This pool's share price isn't known yet.";
    if (Math.floor(amount / vault.sharePrice) < 1) return "Too small for one pool share.";
  }
  return null;
}
