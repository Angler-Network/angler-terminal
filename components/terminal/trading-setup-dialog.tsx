"use client";

import { Check, KeyRound, Landmark, Loader2, ReceiptText, X } from "lucide-react";
import { useEffect, useState } from "react";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import { lighterConfig } from "@/lib/venues/lighter/config";
import { LighterFaucetButton } from "./lighter-faucet-button";
import { useTrading } from "./trading-provider";
import { useModalEnter } from "@/components/app/use-motion";

function feeLabel(tenthsOfBps: number) {
  return `${(tenthsOfBps / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

interface StepProps {
  index: number;
  title: string;
  description: string;
  done: boolean;
  active: boolean;
  busy: boolean;
  action: string;
  Icon: typeof KeyRound;
  onRun: () => void;
  /** Label while busy; most steps wait for a wallet signature. */
  busyLabel?: string;
  /** Extra controls next to the action (e.g. a deposit link). */
  extra?: React.ReactNode;
}

function Step({ index, title, description, done, active, busy, action, Icon, onRun, busyLabel = "Confirm in your wallet…", extra }: StepProps) {
  return (
    <li className={`flex gap-3 rounded-xl border p-3 ${active ? "border-app-hairline-strong bg-app-chip/60" : "border-app-hairline"}`}>
      <span
        className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
          done ? "bg-app-up text-white" : "bg-app-chip text-app-ink"
        }`}
      >
        {done ? <Check className="size-4" aria-label="Done" /> : index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[14px] font-semibold text-app-ink">
          <Icon className="size-4 text-app-muted" aria-hidden />
          {title}
        </p>
        <p className="mt-1 text-[12px] leading-snug text-app-muted">{description}</p>
        {active && !done && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRun}
              disabled={busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-app-accent px-3 text-[13px] font-semibold text-app-on-accent transition-colors hover:bg-app-accent/85 disabled:opacity-60"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {busy ? busyLabel : action}
            </button>
            {extra}
          </div>
        )}
      </div>
    </li>
  );
}

function HyperliquidSteps() {
  const { onboarding, approveBuilder, createAgent } = useTrading();
  const [busy, setBusy] = useState<1 | 2 | null>(null);
  const builderDone = Boolean(onboarding?.builderApproved);
  const agentDone = Boolean(onboarding?.agentAddress);
  const builder = hlConfig.builder;

  const run = async (step: 1 | 2) => {
    setBusy(step);
    try {
      await (step === 1 ? approveBuilder() : createAgent());
    } finally {
      setBusy(null);
    }
  };

  return (
    <ol className="mt-4 flex flex-col gap-2">
      <Step
        index={1}
        Icon={ReceiptText}
        title="Approve builder fee"
        description={`Lets Angler add a fee of up to ${builder ? feeLabel(builder.maxFee) : "—"} on orders placed from this terminal.`}
        done={builderDone}
        active={!builderDone}
        busy={busy === 1}
        action="Approve fee"
        onRun={() => void run(1)}
      />
      <Step
        index={2}
        Icon={KeyRound}
        title="Create trading key"
        description="Generates a key in this browser that can place and cancel orders but can never withdraw. Revoke it any time."
        done={agentDone}
        active={builderDone && !agentDone}
        busy={busy === 2}
        action="Create key"
        onRun={() => void run(2)}
      />
    </ol>
  );
}

function LighterSteps() {
  const { lighter, refreshLighter, registerLighter, approveLighter } = useTrading();
  const [busy, setBusy] = useState<1 | 2 | 3 | null>(null);
  const referralCode = lighterConfig.referralCode;
  const [useReferral, setUseReferral] = useState(true);
  const accountDone = lighter !== null && lighter.accountIndex !== null;
  const keyDone = Boolean(lighter?.keyReady);
  const integrator = lighterConfig.integrator;

  const run = async (step: 1 | 2 | 3) => {
    setBusy(step);
    try {
      await (step === 1 ? refreshLighter() : step === 2 ? registerLighter() : approveLighter({ referral: Boolean(referralCode) && useReferral }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ol className="mt-4 flex flex-col gap-2">
      <Step
        index={1}
        Icon={Landmark}
        title="Lighter account"
        description={
          lighterConfig.network === "testnet"
            ? "On testnet, the faucet opens your Lighter account with test USDC in one click (about 20 seconds)."
            : "Lighter creates the account on your first deposit. Deposit USDC from this wallet on Lighter, then check again (it can take a few minutes)."
        }
        done={accountDone}
        active={!accountDone}
        busy={busy === 1}
        busyLabel="Checking…"
        action="Check again"
        onRun={() => void run(1)}
        extra={
          <>
          <LighterFaucetButton className="inline-flex h-8 items-center rounded-lg border border-app-accent px-3 text-[13px] font-semibold text-app-accent hover:bg-app-accent/10 disabled:opacity-60" />
          <a
            href={lighterConfig.appUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center rounded-lg border border-app-hairline-strong px-3 text-[13px] font-semibold text-app-ink hover:bg-app-chip"
          >
            Open Lighter
          </a>
          </>
        }
      />
      <Step
        index={2}
        Icon={KeyRound}
        title="Register trading key"
        description={`Generates a key in this browser (stored encrypted) and registers it at key slot ${lighterConfig.apiKeyIndex} with one wallet signature. It can trade and cancel, but can't send funds to another owner.`}
        done={keyDone}
        active={accountDone && !keyDone}
        busy={busy === 2}
        action="Register key"
        onRun={() => void run(2)}
      />
      {integrator && (
        <Step
          index={3}
          Icon={ReceiptText}
          title="Approve Angler"
          description={`Attributes orders placed here to Angler, with a fee of up to ${Number((integrator.maxTakerFee / 100).toFixed(2))} bps on Plus and Premium accounts (none on Standard).`}
          done={lighter?.integrator === "approved"}
          active={keyDone && lighter?.integrator === "needed"}
          busy={busy === 3}
          busyLabel="Approving…"
          action="Approve"
          onRun={() => void run(3)}
          extra={
            referralCode && (
              <label className="flex basis-full items-start gap-2 text-[12px] leading-snug text-app-muted">
                <input
                  type="checkbox"
                  checked={useReferral}
                  onChange={(event) => setUseReferral(event.target.checked)}
                  className="mt-0.5 accent-[rgb(var(--app-accent))]"
                />
                <span>
                  Also use Angler&apos;s Lighter referral code <span className="font-semibold text-app-ink">{referralCode}</span>. It replaces
                  any referral code this Lighter account already uses.
                </span>
              </label>
            )
          }
        />
      )}
    </ol>
  );
}

/**
 * First-trade setup per perp venue. Hyperliquid: approve the builder fee, then create a browser trading key
 * (agent wallet). Lighter: deposit check, register a browser API key, approve the integrator when configured.
 */
export function TradingSetupDialog() {
  const { setupVenue, closeSetup, onboarding, lighter, isVenueReady, network, lighterNetwork } = useTrading();
  const isDone = setupVenue !== null && isVenueReady(setupVenue);

  useEffect(() => {
    if (isDone) {
      const timer = window.setTimeout(closeSetup, 900);
      return () => window.clearTimeout(timer);
    }
  }, [isDone, closeSetup, onboarding, lighter]);

  const backdropRef = useModalEnter(setupVenue !== null);

  if (!setupVenue) return null;
  const isLighter = setupVenue === "lighter";
  const isTestnet = (isLighter ? lighterNetwork : network) === "testnet";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" ref={backdropRef} role="presentation" onClick={closeSetup}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trading-setup-title"
        onClick={(event) => event.stopPropagation()}
        className="surface-menu scrollbar-subtle max-h-[calc(100dvh-2rem)] overflow-y-auto w-full max-w-md rounded-2xl border border-app-hairline-strong bg-app-card p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
      >
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="trading-setup-title" className="text-[16px] font-semibold text-app-ink">
              Set up trading on {isLighter ? "Lighter" : "Hyperliquid"}
            </h2>
            <p className="mt-1 text-[12px] text-app-muted">
              {isLighter ? "One-time setup" : "Two one-time signatures"}
              {isTestnet ? " on testnet" : ""}. No funds move.
            </p>
          </div>
          <button type="button" onClick={closeSetup} aria-label="Close" className="text-app-faint hover:text-app-ink">
            <X className="size-4" />
          </button>
        </header>
        {isLighter ? <LighterSteps /> : <HyperliquidSteps />}
      </div>
    </div>
  );
}
