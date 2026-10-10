"use client";

import { Check, KeyRound, Landmark, Loader2, ReceiptText, X } from "lucide-react";
import { useEffect, useState } from "react";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import { isLighterVenue, lighterConfigs, type LighterVenueId } from "@/lib/venues/lighter/config";
import { ASTER_APP_URL, asterConfig } from "@/lib/venues/aster/config";
import { orderlyConfig } from "@/lib/venues/orderly/config";
import { extendedConfig } from "@/lib/venues/extended/config";
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
  const referralCode = hlConfig.referralCode;
  const [useReferral, setUseReferral] = useState(true);

  const run = async (step: 1 | 2) => {
    setBusy(step);
    try {
      await (step === 1 ? approveBuilder() : createAgent({ referral: Boolean(referralCode) && useReferral }));
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
        extra={
          referralCode &&
          !agentDone && (
            <label className="flex basis-full items-start gap-2 text-[12px] leading-snug text-app-muted">
              <input
                type="checkbox"
                checked={useReferral}
                onChange={(event) => setUseReferral(event.target.checked)}
                className="mt-0.5 accent-[rgb(var(--app-accent))]"
              />
              <span>
                Also use Angler&apos;s Hyperliquid referral code <span className="font-semibold text-app-ink">{referralCode}</span>: 4% off
                Hyperliquid&apos;s fees on your first $25M. Skipped if this account already has a referral code.
              </span>
            </label>
          )
        }
      />
    </ol>
  );
}

/** Aster: approve our builder fee (when one is configured), then a browser trading key that can never withdraw. */
function AsterSteps() {
  const { aster, approveAster } = useTrading();
  const [busy, setBusy] = useState<"builder" | "agent" | null>(null);
  const builder = asterConfig.builder;
  const builderDone = !builder || aster?.builder === "approved";
  const agentDone = Boolean(aster?.agentReady);
  const run = async (step: "builder" | "agent") => {
    setBusy(step);
    try {
      await approveAster(step);
    } finally {
      setBusy(null);
    }
  };
  return (
    <ol className="mt-4 flex flex-col gap-2">
      {builder && (
        <Step
          index={1}
          Icon={ReceiptText}
          title="Approve builder fee"
          description={`Lets Angler add a fee of up to ${Number((builder.maxFeeRate * 100).toFixed(4))}% on Aster orders placed from this terminal. Your wallet may switch to BNB Chain to sign.`}
          done={builderDone}
          active={!builderDone}
          busy={busy === "builder"}
          action="Approve fee"
          onRun={() => void run("builder")}
        />
      )}
      <Step
        index={builder ? 2 : 1}
        Icon={KeyRound}
        title="Create trading key"
        description="Generates a key in this browser that can place and cancel Aster perp orders but can never withdraw. It also turns on Multi-Assets mode so USDC deposits count as margin."
        done={agentDone}
        active={builderDone && !agentDone}
        busy={busy === "agent"}
        action="Create key"
        onRun={() => void run("agent")}
        extra={
          <a
            href={ASTER_APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center rounded-lg border border-app-hairline-strong px-3 text-[13px] font-semibold text-app-ink hover:bg-app-chip"
          >
            Open Aster
          </a>
        }
      />
    </ol>
  );
}

/**
 * Orderly: register the wallet's account under our broker (once, for good), then a browser trading key (read and trade,
 * never withdraw; valid a year). Both are wallet signatures on Arbitrum, where deposits go.
 */
function OrderlySteps() {
  const { orderly, approveOrderly, openDeposit } = useTrading();
  const [busy, setBusy] = useState<"register" | "key" | null>(null);
  const registered = Boolean(orderly?.registered);
  const keyDone = Boolean(orderly?.keyReady);
  const chain = orderlyConfig.network === "mainnet" ? "Arbitrum" : "Arbitrum Sepolia";
  const run = async (step: "register" | "key") => {
    setBusy(step);
    try {
      await approveOrderly(step);
    } finally {
      setBusy(null);
    }
  };
  return (
    <ol className="mt-4 flex flex-col gap-2">
      <Step
        index={1}
        Icon={ReceiptText}
        title="Create your Orderly account"
        description={`Registers this wallet on Orderly through Angler. One signature, no gas; your wallet may switch to ${chain} to sign.`}
        done={registered}
        active={!registered}
        busy={busy === "register"}
        action="Register"
        onRun={() => void run("register")}
      />
      <Step
        index={2}
        Icon={KeyRound}
        title="Create trading key"
        description="Generates a key in this browser that can place and cancel Orderly orders but can never withdraw. It's stored encrypted here and expires in a year."
        done={keyDone}
        active={registered && !keyDone}
        busy={busy === "key"}
        action="Create key"
        onRun={() => void run("key")}
        extra={
          registered ? (
            <button
              type="button"
              onClick={() => openDeposit("orderly", "deposit")}
              className="inline-flex h-8 items-center rounded-lg border border-app-hairline-strong px-3 text-[13px] font-semibold text-app-ink hover:bg-app-chip"
            >
              Deposit USDC
            </button>
          ) : undefined
        }
      />
    </ol>
  );
}

/**
 * Extended: one step with the wallet: a signature that derives this account's Stark key (the same signature always gives
 * the same key, so an existing Extended account comes back), one that registers it, and a signed message for its API
 * key. Orders then sign in this browser.
 */
function ExtendedSteps() {
  const { extended, approveExtended } = useTrading();
  const [busy, setBusy] = useState(false);
  const referralCode = extendedConfig.referralCode;
  const [useReferral, setUseReferral] = useState(true);
  const done = Boolean(extended?.ready);
  return (
    <ol className="mt-4 flex flex-col gap-2">
      <Step
        index={1}
        Icon={KeyRound}
        title="Connect your Extended account"
        description="Three wallet prompts, no gas: one derives your Extended trading key, one registers the account (an existing Extended account is reused), one creates its API key. Both keys stay encrypted in this browser."
        done={done}
        active={!done}
        busy={busy}
        action="Connect"
        onRun={async () => {
          setBusy(true);
          try {
            await approveExtended({ referral: Boolean(referralCode) && useReferral });
          } finally {
            setBusy(false);
          }
        }}
        extra={
          referralCode && !done ? (
            <label className="flex items-center gap-2 text-[12px] text-app-muted">
              <input type="checkbox" checked={useReferral} onChange={(event) => setUseReferral(event.target.checked)} />
              Use Angler&apos;s Extended referral code (new accounts only)
            </label>
          ) : undefined
        }
      />
      <li className="rounded-lg bg-app-chip/40 px-3 py-2 text-[12px] text-app-muted">
        Deposits happen on{" "}
        <a href={extendedConfig.app} target="_blank" rel="noopener noreferrer" className="font-semibold text-app-ink hover:underline">
          Extended&apos;s app
        </a>{" "}
        for now. Not available in the US, the UK, Canada and Extended&apos;s other restricted countries.
      </li>
    </ol>
  );
}

/** Setup of one Lighter exchange: core Lighter, or Lighter on Robinhood Chain (same steps, its own account and key). */
function LighterSteps({ venue }: { venue: LighterVenueId }) {
  const { lighterStates, refreshLighter, registerLighter, approveLighter, openDeposit } = useTrading();
  const config = lighterConfigs[venue];
  const lighter = lighterStates[venue];
  const [busy, setBusy] = useState<1 | 2 | 3 | null>(null);
  const referralCode = config.referralCode;
  const [useReferral, setUseReferral] = useState(true);
  const accountDone = lighter !== null && lighter.accountIndex !== null;
  const keyDone = Boolean(lighter?.keyReady);
  const integrator = config.integrator;
  const isRh = venue === "lighterRh";

  const run = async (step: 1 | 2 | 3) => {
    setBusy(step);
    try {
      await (step === 1 ? refreshLighter(venue) : step === 2 ? registerLighter(venue) : approveLighter({ venue, referral: Boolean(referralCode) && useReferral }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ol className="mt-4 flex flex-col gap-2">
      <Step
        index={1}
        Icon={Landmark}
        title={`${config.name} account`}
        description={
          isRh
            ? "Lighter on Robinhood creates the account on your first USDG deposit from this wallet on Robinhood Chain (1 USDG minimum). Deposit, then check again."
            : config.network === "testnet"
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
          isRh ? (
            <button
              type="button"
              onClick={() => openDeposit(venue)}
              className="inline-flex h-8 items-center rounded-lg border border-app-accent px-3 text-[13px] font-semibold text-app-accent hover:bg-app-accent/10"
            >
              Deposit USDG
            </button>
          ) : (
            <>
              <LighterFaucetButton className="inline-flex h-8 items-center rounded-lg border border-app-accent px-3 text-[13px] font-semibold text-app-accent hover:bg-app-accent/10 disabled:opacity-60" />
              {config.appUrl && (
                <a
                  href={config.appUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center rounded-lg border border-app-hairline-strong px-3 text-[13px] font-semibold text-app-ink hover:bg-app-chip"
                >
                  Open Lighter
                </a>
              )}
            </>
          )
        }
      />
      <Step
        index={2}
        Icon={KeyRound}
        title="Register trading key"
        description={`Generates a key in this browser (stored encrypted) and registers it at ${config.name} key slot ${config.apiKeyIndex} with one wallet signature. It can trade and cancel, but can't send funds to another owner.`}
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
                  Also use Angler&apos;s {config.name} referral code <span className="font-semibold text-app-ink">{referralCode}</span>. It replaces
                  any referral code this account already uses.
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
  const { setupVenue, closeSetup, onboarding, lighterStates, aster, orderly, extended, isVenueReady, network } = useTrading();
  const isDone = setupVenue !== null && isVenueReady(setupVenue);

  useEffect(() => {
    if (isDone) {
      const timer = window.setTimeout(closeSetup, 900);
      return () => window.clearTimeout(timer);
    }
  }, [isDone, closeSetup, onboarding, lighterStates, aster, orderly, extended]);

  const backdropRef = useModalEnter(setupVenue !== null);

  if (!setupVenue) return null;
  const lighterVenue = isLighterVenue(setupVenue) ? setupVenue : null;
  const isAster = setupVenue === "aster";
  const isOrderly = setupVenue === "orderly";
  const isExtended = setupVenue === "extended";
  const isTestnet = isExtended
    ? extendedConfig.network === "testnet"
    : isOrderly
      ? orderlyConfig.network === "testnet"
      : !isAster && (lighterVenue ? lighterConfigs[lighterVenue].network : network) === "testnet";

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
              Set up trading on {isAster ? "Aster" : isOrderly ? "Orderly" : isExtended ? "Extended" : lighterVenue ? lighterConfigs[lighterVenue].name : "Hyperliquid"}
            </h2>
            <p className="mt-1 text-[12px] text-app-muted">
              {lighterVenue || isAster || isExtended ? "One-time setup" : "Two one-time signatures"}
              {isTestnet ? " on testnet" : ""}. No funds move.
            </p>
          </div>
          <button type="button" onClick={closeSetup} aria-label="Close" className="text-app-faint hover:text-app-ink">
            <X className="size-4" />
          </button>
        </header>
        {isAster ? <AsterSteps /> : isOrderly ? <OrderlySteps /> : isExtended ? <ExtendedSteps /> : lighterVenue ? <LighterSteps venue={lighterVenue} /> : <HyperliquidSteps />}
      </div>
    </div>
  );
}
