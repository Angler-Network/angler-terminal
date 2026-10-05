"use client";

import { Check, KeyRound, Loader2, ReceiptText, X } from "lucide-react";
import { useEffect, useState } from "react";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import { useTrading } from "./trading-provider";

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
}

function Step({ index, title, description, done, active, busy, action, Icon, onRun }: StepProps) {
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
          <button
            type="button"
            onClick={onRun}
            disabled={busy}
            className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-lg bg-app-accent px-3 text-[13px] font-semibold text-app-on-accent transition-colors hover:bg-app-accent/85 disabled:opacity-60"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {busy ? "Confirm in your wallet…" : action}
          </button>
        )}
      </div>
    </li>
  );
}

/** First-trade setup: approve the builder fee, then create a browser trading key (agent wallet). */
export function TradingSetupDialog() {
  const { isSetupOpen, closeSetup, onboarding, approveBuilder, createAgent, network } = useTrading();
  const [busy, setBusy] = useState<1 | 2 | null>(null);
  const builderDone = Boolean(onboarding?.builderApproved);
  const agentDone = Boolean(onboarding?.agentAddress);

  useEffect(() => {
    if (isSetupOpen && builderDone && agentDone) {
      const timer = window.setTimeout(closeSetup, 900);
      return () => window.clearTimeout(timer);
    }
  }, [isSetupOpen, builderDone, agentDone, closeSetup]);

  if (!isSetupOpen) return null;
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" role="presentation" onClick={closeSetup}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trading-setup-title"
        onClick={(event) => event.stopPropagation()}
        className="surface-menu w-full max-w-md rounded-2xl border border-app-hairline-strong bg-app-card p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
      >
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="trading-setup-title" className="text-[16px] font-semibold text-app-ink">
              Set up trading on Hyperliquid
            </h2>
            <p className="mt-1 text-[12px] text-app-muted">
              Two one-time signatures{network === "testnet" ? " on testnet" : ""}. No funds move.
            </p>
          </div>
          <button type="button" onClick={closeSetup} aria-label="Close" className="text-app-faint hover:text-app-ink">
            <X className="size-4" />
          </button>
        </header>
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
      </div>
    </div>
  );
}
