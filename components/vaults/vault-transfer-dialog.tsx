"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/app/toast-provider";
import { useModalEnter } from "@/components/app/use-motion";
import { useTrading } from "@/components/terminal/trading-provider";
import { VenueLogo } from "@/components/terminal/venue-logo";
import { useWallet } from "@/components/terminal/wallet-provider";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { hlVaultTransfer } from "@/lib/venues/hyperliquid/vaults";
import { lighterConfigs } from "@/lib/venues/lighter/config";
import { lighterPoolTransfer } from "@/lib/venues/lighter/pools";
import type { VaultStake } from "@/lib/vaults/parse";
import { hlVaultUsd, hlWithdrawUsd, lighterShares, vaultTransferError, type InAppVaultVenue, type VaultTransferMode } from "@/lib/vaults/transfer";
import { VAULT_VENUE_NAMES, type VaultRow } from "@/lib/vaults/types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const STOPS = [25, 50, 75, 100];
const floorCents = (value: number) => Math.floor(value * 100 + 1e-6) / 100;

/**
 * Deposit into or withdraw from a Hyperliquid vault or a Lighter pool without leaving the terminal. The venue's trading
 * key signs (no wallet popup); deposits spend the perp margin and withdrawals return to it.
 */
export function VaultTransferDialog({
  vault,
  stake,
  initialMode,
  onClose,
  onDone,
}: {
  vault: VaultRow & { venue: InAppVaultVenue };
  stake: VaultStake | null;
  initialMode: VaultTransferMode;
  onClose: () => void;
  onDone: () => void;
}) {
  const backdropRef = useModalEnter(true);
  const toast = useToast();
  const { address } = useWallet();
  const { open: openWallets } = useWalletModal();
  const { accounts, isVenueReady, openSetup } = useTrading();
  const [mode, setMode] = useState<VaultTransferMode>(stake?.value ? initialMode : "deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const venueName = VAULT_VENUE_NAMES[vault.venue];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const snapshot = accounts[vault.venue];
  const available = snapshot ? snapshot.withdrawable : null;
  const ceiling = mode === "deposit" ? available : (stake?.value ?? null);
  const value = Number(amount);
  const error = vaultTransferError({ mode, amount: value, available, vault, stake, now: Date.now() });
  const ready = address ? isVenueReady(vault.venue) : false;

  const submit = async () => {
    if (!address) return openWallets();
    if (!ready) return openSetup(vault.venue);
    if (error || !(value > 0)) return;
    setBusy(true);
    try {
      if (vault.venue === "hyperliquid") {
        const micro = mode === "deposit" ? hlVaultUsd(value) : hlWithdrawUsd(value, stake?.value ?? 0);
        await hlVaultTransfer(address, vault.id, micro, mode === "deposit");
      } else {
        const held = Object.values(stake?.shares ?? {}).reduce((sum, shares) => sum + shares, 0);
        const shares = lighterShares(mode, value, vault.sharePrice ?? 0, held);
        await lighterPoolTransfer(lighterConfigs[vault.venue], address, Number(vault.id), mode === "deposit" ? "mint" : "burn", shares, stake?.shares);
      }
      toast({
        tone: "success",
        title: mode === "deposit" ? `Deposited ${usd.format(value)} into ${vault.name}` : `Withdrew ${usd.format(value)} from ${vault.name}`,
        message: mode === "deposit" ? `From your ${venueName} margin.` : `Back in your ${venueName} margin.`,
      });
      onDone();
      onClose();
    } catch (caught) {
      toast({ tone: "error", title: mode === "deposit" ? "Deposit failed" : "Withdrawal failed", message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(false);
    }
  };

  const button = !address
    ? "Connect wallet"
    : !ready
      ? `Set up ${venueName} trading`
      : busy
        ? mode === "deposit"
          ? "Depositing…"
          : "Withdrawing…"
        : mode === "deposit"
          ? "Deposit"
          : "Withdraw";

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" ref={backdropRef} role="presentation" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${mode === "deposit" ? "Deposit into" : "Withdraw from"} ${vault.name}`}
        onClick={(event) => event.stopPropagation()}
        className="surface-menu scrollbar-subtle flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col gap-3 overflow-y-auto rounded-2xl border border-app-hairline-strong bg-app-card p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
      >
        <header className="flex items-start gap-2.5">
          <VenueLogo name={venueName} size={28} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold text-app-ink">{vault.name}</h2>
            <p className="text-[12px] tabular-nums text-app-muted">
              {venueName}
              {stake?.value ? ` · yours ${usd.format(stake.value)}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-app-faint hover:text-app-ink">
            <X className="size-4" />
          </button>
        </header>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-app-chip/60 p-1">
          {(["deposit", "withdraw"] as const).map((id) => (
            <button
              key={id}
              type="button"
              disabled={id === "withdraw" && !stake?.value}
              aria-pressed={mode === id}
              onClick={() => {
                setMode(id);
                setAmount("");
              }}
              className={`h-8 rounded-md text-[13px] font-semibold transition-colors disabled:opacity-40 ${mode === id ? "bg-app-card text-app-ink shadow-sm" : "text-app-muted hover:text-app-ink"}`}
            >
              {id === "deposit" ? "Deposit" : "Withdraw"}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between text-[11px] text-app-muted">
            Amount
            <span className="tabular-nums">
              {mode === "deposit" ? "Free margin" : "In the vault"} {ceiling === null ? "—" : usd.format(ceiling)}
            </span>
          </span>
          <span className="flex h-10 items-center rounded-lg border border-app-field-border bg-app-field px-3 focus-within:border-app-ink">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
              aria-label="Amount in USD"
              className="min-w-0 flex-1 bg-transparent text-[15px] tabular-nums text-app-ink outline-hidden placeholder:text-app-faint"
            />
            <span className="text-[12px] font-semibold text-app-muted">{vault.venue === "lighterRh" ? "USDG" : "USDC"}</span>
          </span>
        </label>
        <div className="grid grid-cols-4 gap-1.5">
          {STOPS.map((stop) => (
            <button
              key={stop}
              type="button"
              disabled={!ceiling}
              onClick={() => ceiling && setAmount(String(floorCents((ceiling * stop) / 100)))}
              className="h-7 rounded-md bg-app-chip text-[12px] font-semibold text-app-muted hover:text-app-ink disabled:opacity-40"
            >
              {stop === 100 ? "Max" : `${stop}%`}
            </button>
          ))}
        </div>

        {error && <p className="text-[12px] text-app-down">{error}</p>}

        <ul className="flex flex-col gap-1 rounded-lg bg-app-chip/40 px-3 py-2 text-[12px] text-app-muted">
          <li>{mode === "deposit" ? `Comes out of your ${venueName} margin` : `Goes back to your ${venueName} margin`}; no fee from Angler.</li>
          {mode === "deposit" && vault.lockHours ? <li>Locked for {vault.lockHours >= 48 ? `${Math.round(vault.lockHours / 24)} days` : `${vault.lockHours} hours`} after each deposit.</li> : null}
          {vault.profitShare ? <li>The manager keeps {Math.round(vault.profitShare * 100)}% of the profits.</li> : null}
          {vault.venue !== "hyperliquid" && vault.sharePrice ? <li>Priced in pool shares; the amount out follows the pool&apos;s value.</li> : null}
          <li>The manager trades this money: it can lose value.</li>
        </ul>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || (ready && (Boolean(error) || !(value > 0)))}
          className="h-10 rounded-xl bg-app-accent text-[14px] font-semibold text-app-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {button}
        </button>
      </div>
    </div>,
    document.body,
  );
}
