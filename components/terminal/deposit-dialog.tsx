"use client";

import { ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/components/app/toast-provider";
import { formatPrice } from "@/lib/format";
import { lighterIntentAddress, readUsdcBalance, sendUsdc } from "@/lib/venues/deposit-client";
import {
  ARBITRUM,
  HL_BRIDGE,
  HL_WITHDRAW_FEE_USDC,
  depositError,
  depositPlan,
  moveError,
  usdcUnits,
  USDC_DECIMALS,
  withdrawalArrived,
  type SourceChain,
} from "@/lib/venues/deposits";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId } from "@/lib/venues/types";
import { LighterFaucetButton } from "./lighter-faucet-button";
import { useTrading, type FundsMode } from "./trading-provider";
import { useWalletModal } from "./wallet-modal";
import { useWallet } from "./wallet-provider";
import { useModalEnter } from "@/components/app/use-motion";

type Mode = FundsMode;

const ARRIVAL_POLL_MS = 10_000;
const ARRIVAL_TIMEOUT_MS = 12 * 60_000;

type MoveStep = { kind: "idle" } | { kind: "waiting"; before: bigint; units: bigint; since: number } | { kind: "arrived"; units: bigint } | { kind: "done"; explorerUrl: string };

/**
 * Hyperliquid → Lighter in two wallet signatures: withdraw from Hyperliquid to the wallet on Arbitrum (3-4 min),
 * wait for it to land, then send it to the wallet's Lighter deposit address.
 */
function MoveFunds() {
  const toast = useToast();
  const { accounts, withdrawHyperliquid, network, lighterNetwork } = useTrading();
  const { address, wallet } = useWallet();
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<MoveStep>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const withdrawable = accounts.hyperliquid?.withdrawable;
  const value = Number(amount);
  const error = moveError(value, withdrawable);
  const mainnet = network === "mainnet" && lighterNetwork === "mainnet";

  useEffect(() => {
    if (step.kind !== "waiting" || !address) return;
    const timer = window.setInterval(async () => {
      const now = await readUsdcBalance(ARBITRUM, address).catch(() => null);
      if (now !== null && withdrawalArrived(step.before, now, step.units)) setStep({ kind: "arrived", units: step.units });
      else if (Date.now() - step.since > ARRIVAL_TIMEOUT_MS) {
        toast({ tone: "error", title: "Withdrawal is taking longer than usual", message: "Check your wallet on Arbitrum, then deposit to Lighter from the Deposit tab." });
        setStep({ kind: "idle" });
      }
    }, ARRIVAL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [step, address, toast]);

  if (!mainnet) {
    return <p className="text-[13px] text-app-muted">Moving funds between venues works on mainnet. On testnet, get test USDC from each venue&apos;s faucet.</p>;
  }

  const start = async () => {
    if (!address || error) return;
    setBusy(true);
    try {
      const before = await readUsdcBalance(ARBITRUM, address);
      const units = usdcUnits(String(Math.floor((value - HL_WITHDRAW_FEE_USDC) * 1e6) / 1e6)) ?? 0n;
      if (await withdrawHyperliquid(String(value))) setStep({ kind: "waiting", before, units, since: Date.now() });
    } catch (caught) {
      toast({ tone: "error", title: "Couldn't start the move", message: caught instanceof Error ? caught.message.split("\n")[0] : String(caught) });
    } finally {
      setBusy(false);
    }
  };

  const finish = async (units: bigint) => {
    if (!address || !wallet) return;
    setBusy(true);
    try {
      const to = await lighterIntentAddress(ARBITRUM, address);
      const result = await sendUsdc(wallet.provider, address, ARBITRUM, to, units);
      setStep({ kind: "done", explorerUrl: result.explorerUrl });
      toast({ tone: "success", title: "Moved to Lighter", message: "Credited to your Lighter account in a few minutes.", link: { href: result.explorerUrl, label: "View transaction" } });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message.split("\n")[0] : String(caught);
      toast({ tone: "error", title: "Deposit not sent", message: /reject|denied/i.test(message) ? "You rejected the request in your wallet. The USDC is in your wallet on Arbitrum." : message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-1 text-[12px] text-app-muted">
        <li className={step.kind === "idle" ? "font-semibold text-app-ink" : ""}>1. Withdraw from Hyperliquid to your wallet (signature, no gas, 1 USDC fee)</li>
        <li className={step.kind === "waiting" ? "font-semibold text-app-ink" : ""}>2. Wait for it to land on Arbitrum (3-4 minutes)</li>
        <li className={step.kind === "arrived" ? "font-semibold text-app-ink" : ""}>3. Deposit it to Lighter (one transaction, a little ETH for gas)</li>
      </ol>
      {step.kind === "idle" && (
        <>
          <label className="flex flex-col gap-1 text-[12px] text-app-muted">
            <span className="flex items-center justify-between">
              USDC to move
              {withdrawable !== undefined && (
                <button type="button" onClick={() => setAmount(String(Math.floor(withdrawable * 100) / 100))} className="font-semibold text-app-ink hover:underline">
                  Hyperliquid withdrawable {formatPrice(withdrawable)}
                </button>
              )}
            </span>
            <input className={inputClass} inputMode="decimal" placeholder="Amount (min 6)" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} />
          </label>
          {amount && error && <p className="text-[12px] text-app-down">{error}</p>}
          <button
            type="button"
            disabled={busy || Boolean(error) || !address}
            onClick={() => void start()}
            className="h-10 rounded-lg bg-app-accent text-[13px] font-semibold text-app-on-accent disabled:opacity-50"
          >
            {busy ? "Confirm in your wallet…" : `Withdraw ${amount || ""} USDC from Hyperliquid`}
          </button>
        </>
      )}
      {step.kind === "waiting" && <p className="text-[13px] text-app-ink">Waiting for the USDC to reach your wallet on Arbitrum… You can keep trading; leave this window open.</p>}
      {step.kind === "arrived" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void finish(step.units)}
          className="h-10 rounded-lg bg-app-accent text-[13px] font-semibold text-app-on-accent disabled:opacity-50"
        >
          {busy ? "Confirm in your wallet…" : `Deposit ${(Number(step.units) / 10 ** USDC_DECIMALS).toFixed(2)} USDC to Lighter`}
        </button>
      )}
      {step.kind === "done" && (
        <a href={step.explorerUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-app-up hover:underline">
          Sent to Lighter. Arrives in a few minutes. View transaction
        </a>
      )}
    </div>
  );
}

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
  const { depositVenue, depositMode, closeDeposit, openDeposit, network, lighterNetwork, accounts, withdrawHyperliquid } = useTrading();
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
    // Withdraw belongs to Hyperliquid, Move (from Hyperliquid) to Lighter.
    setMode((current) => (venue === "hyperliquid" ? (current === "move" ? "deposit" : current) : current === "withdraw" ? "deposit" : current));
  }, [venue]);
  useEffect(() => {
    if (depositVenue) setMode(depositMode);
  }, [depositVenue, depositMode]);

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

  const backdropRef = useModalEnter(depositVenue !== null);

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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" ref={backdropRef} role="presentation" onClick={closeDeposit}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="deposit-title"
        onClick={(event) => event.stopPropagation()}
        className="surface-menu scrollbar-subtle max-h-[calc(100dvh-2rem)] overflow-y-auto flex w-full max-w-md flex-col gap-3 rounded-2xl border border-app-hairline-strong bg-app-card p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
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
        <Tabs
          value={mode}
          options={
            canWithdraw
              ? [
                  { value: "deposit", label: "Deposit" },
                  { value: "withdraw", label: "Withdraw" },
                ]
              : [
                  { value: "deposit", label: "Deposit" },
                  { value: "move", label: "Move from Hyperliquid" },
                ]
          }
          onChange={setMode}
        />
        {mode === "move" && <MoveFunds />}

        {mode === "deposit" && plan.kind === "faucet" && (
          <div className="flex flex-col gap-2 text-[13px] text-app-muted">
            <p>{PERP_VENUE_NAMES[venue]} is on testnet: test USDC comes from its faucet, not from your wallet.</p>
            {venue === "lighter" && (
              <LighterFaucetButton
                label="Get test USDC now"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-app-accent text-[13px] font-semibold text-app-on-accent hover:opacity-90 disabled:opacity-60"
              />
            )}
            <a
              href={plan.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold ${
                venue === "lighter" ? "border border-app-hairline-strong text-app-ink hover:bg-app-chip" : "bg-app-accent text-app-on-accent"
              }`}
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
