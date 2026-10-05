"use client";

import { ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/components/app/toast-provider";
import { formatPrice } from "@/lib/format";
import { lighterIntentAddress, readUsdcBalance, sendUsdc } from "@/lib/venues/deposit-client";
import { HL_BRIDGE, depositError, depositPlan, usdcUnits, USDC_DECIMALS, type SourceChain } from "@/lib/venues/deposits";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId } from "@/lib/venues/types";
import { useTrading } from "./trading-provider";
import { useWalletModal } from "./wallet-modal";
import { useWallet } from "./wallet-provider";

type Mode = "deposit" | "withdraw";

const inputClass =
  "h-10 w-full rounded-lg border border-app-field-border bg-app-field px-3 text-[14px] tabular-nums text-app-ink outline-none focus:border-app-ink";

function Tabs<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div className="flex gap-0.5 rounded-lg bg-app-chip p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-8 flex-1 rounded-md text-[12px] font-semibold ${value === option.value ? "bg-app-card text-app-ink shadow-sm" : "text-app-muted hover:text-app-ink"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Moves USDC from the user's wallet into a perp venue (mainnet: an on-chain transfer the wallet signs; testnet: the
 * venue's faucet), and out of Hyperliquid back to the wallet.
 */
export function DepositDialog() {
  const toast = useToast();
  const { depositVenue, closeDeposit, openDeposit, network, lighterNetwork, accounts, withdrawHyperliquid } = useTrading();
  const { address, wallet } = useWallet();
  const { open: openWallets } = useWalletModal();
  const [mode, setMode] = useState<Mode>("deposit");
  const [sourceIndex, setSourceIndex] = useState(0);
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ explorerUrl: string; arrival: string } | null>(null);

  const venue: PerpVenueId = depositVenue ?? "hyperliquid";
  const venueNetwork = venue === "hyperliquid" ? network : lighterNetwork;
  const plan = depositPlan(venue, venueNetwork);
  const source: SourceChain | null = plan.kind === "transfer" ? (plan.sources[sourceIndex] ?? plan.sources[0]) : null;
  const units = usdcUnits(amount);
  const error = mode === "deposit" ? depositError(units, balance) : null;
  const withdrawable = accounts.hyperliquid?.withdrawable;
  const canWithdraw = venue === "hyperliquid";

  useEffect(() => {
    setAmount("");
    setDone(null);
    setSourceIndex(0);
    if (!canWithdraw) setMode("deposit");
  }, [venue, canWithdraw]);

  useEffect(() => {
    setBalance(null);
    if (!address || !source || mode !== "deposit") return;
    let isActive = true;
    readUsdcBalance(source, address)
      .then((value) => isActive && setBalance(value))
      .catch(() => {});
    return () => {
      isActive = false;
    };
  }, [address, source, mode]);

  if (!depositVenue) return null;

  const deposit = async () => {
    if (!address || !wallet) return openWallets();
    if (!source || plan.kind !== "transfer" || units === null || error) return;
    setBusy(true);
    try {
      const to = plan.target === "bridge" ? HL_BRIDGE : await lighterIntentAddress(source, address);
      const result = await sendUsdc(wallet.provider, address, source, to, units);
      setDone({ explorerUrl: result.explorerUrl, arrival: plan.arrival });
      toast({ tone: "success", title: `Deposited ${amount} USDC`, message: `Credited to ${PERP_VENUE_NAMES[venue]} in ${plan.arrival}.`, link: { href: result.explorerUrl, label: "View transaction" } });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message.split("\n")[0] : String(caught);
      toast({ tone: "error", title: "Deposit not sent", message: /reject|denied/i.test(message) ? "You rejected the request in your wallet." : message });
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!address) return openWallets();
    const value = Number(amount);
    if (!(value > 1) || (withdrawable !== undefined && value > withdrawable)) return;
    setBusy(true);
    const ok = await withdrawHyperliquid(String(value));
    setBusy(false);
    if (ok) closeDeposit();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" role="presentation" onClick={closeDeposit}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="deposit-title"
        onClick={(event) => event.stopPropagation()}
        className="surface-menu flex w-full max-w-md flex-col gap-3 rounded-2xl border border-app-hairline-strong bg-app-card p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
      >
        <header className="flex items-center gap-3">
          <h2 id="deposit-title" className="flex-1 text-[16px] font-semibold text-app-ink">
            Funds
          </h2>
          <span className="rounded bg-app-chip px-1.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em] text-app-muted">{venueNetwork}</span>
          <button type="button" onClick={closeDeposit} aria-label="Close" className="text-app-faint hover:text-app-ink">
            <X className="size-4" />
          </button>
        </header>
        <Tabs
          value={venue}
          options={[
            { value: "hyperliquid", label: "Hyperliquid" },
            { value: "lighter", label: "Lighter" },
          ]}
          onChange={openDeposit}
        />
        {canWithdraw && (
          <Tabs
            value={mode}
            options={[
              { value: "deposit", label: "Deposit" },
              { value: "withdraw", label: "Withdraw" },
            ]}
            onChange={setMode}
          />
        )}

        {mode === "deposit" && plan.kind === "faucet" && (
          <div className="flex flex-col gap-2 text-[13px] text-app-muted">
            <p>{PERP_VENUE_NAMES[venue]} is on testnet: test USDC comes from its faucet, not from your wallet.</p>
            <a
              href={plan.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-app-accent text-[13px] font-semibold text-app-on-accent"
            >
              {plan.label} <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        )}

        {mode === "deposit" && plan.kind === "transfer" && (
          <>
            {plan.sources.length > 1 && (
              <Tabs
                value={String(sourceIndex)}
                options={plan.sources.map((entry, index) => ({ value: String(index), label: `From ${entry.name}` }))}
                onChange={(value) => setSourceIndex(Number(value))}
              />
            )}
            <label className="flex flex-col gap-1 text-[12px] text-app-muted">
              <span className="flex items-center justify-between">
                USDC on {source?.name}
                {balance !== null && (
                  <button type="button" onClick={() => setAmount((Number(balance) / 10 ** USDC_DECIMALS).toString())} className="font-semibold text-app-ink hover:underline">
                    Wallet {formatPrice(Number(balance) / 10 ** USDC_DECIMALS)}
                  </button>
                )}
              </span>
              <input className={inputClass} inputMode="decimal" placeholder="Amount (min 5)" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            <p className="text-[12px] text-app-muted">
              {plan.target === "bridge"
                ? `Sends native USDC on Arbitrum to Hyperliquid's bridge; it is credited to this wallet in ${plan.arrival}. Less than 5 USDC is lost.`
                : `Sends USDC on ${source?.name} to your Lighter deposit address (via Circle CCTP); it is credited to this wallet's Lighter account in ${plan.arrival}.`}{" "}
              Your wallet pays a little ETH for gas.
            </p>
            {amount && error && <p className="text-[12px] text-app-down">{error}</p>}
            {done && (
              <a href={done.explorerUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-app-up hover:underline">
                Sent. Arrives in {done.arrival}. View transaction
              </a>
            )}
            <button
              type="button"
              disabled={busy || (Boolean(address) && Boolean(error))}
              onClick={() => void deposit()}
              className="h-10 rounded-lg bg-app-accent text-[13px] font-semibold text-app-on-accent disabled:opacity-50"
            >
              {!address ? "Connect wallet" : busy ? "Confirm in your wallet…" : `Deposit ${amount || ""} USDC to ${PERP_VENUE_NAMES[venue]}`}
            </button>
          </>
        )}

        {mode === "withdraw" && (
          <>
            <label className="flex flex-col gap-1 text-[12px] text-app-muted">
              <span className="flex items-center justify-between">
                USDC to your wallet on Arbitrum
                {withdrawable !== undefined && (
                  <button type="button" onClick={() => setAmount(String(Math.floor(withdrawable * 100) / 100))} className="font-semibold text-app-ink hover:underline">
                    Withdrawable {formatPrice(withdrawable)}
                  </button>
                )}
              </span>
              <input className={inputClass} inputMode="decimal" placeholder="Amount" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            <p className="text-[12px] text-app-muted">Your wallet signs once (no gas). Hyperliquid sends it in 3-4 minutes and charges a 1 USDC fee.</p>
            <button
              type="button"
              disabled={busy || (Boolean(address) && !(Number(amount) > 1))}
              onClick={() => void withdraw()}
              className="h-10 rounded-lg bg-app-accent text-[13px] font-semibold text-app-on-accent disabled:opacity-50"
            >
              {!address ? "Connect wallet" : busy ? "Confirm in your wallet…" : `Withdraw ${amount || ""} USDC`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
