"use client";

import { ArrowLeftRight, ChevronDown, ExternalLink, Wallet, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/app/toast-provider";
import { formatPrice } from "@/lib/format";
import { lighterIntentAddress, readUsdcBalance, sendUsdc } from "@/lib/venues/deposit-client";
import { isLighterVenue, lighterConfigs } from "@/lib/venues/lighter/config";
import { usePreferences } from "@/components/app/preferences-provider";
import { ARBITRUM, HL_BRIDGE, HL_WITHDRAW_FEE_USDC, usdcUnits, USDC_DECIMALS, withdrawalArrived, type SourceChain } from "@/lib/venues/deposits";
import { summarizeAcrossQuote, type AcrossQuoteSummary } from "@/lib/venues/across";
import {
  BRIDGE_VENUES,
  WALLET_CHAINS,
  acrossRecipientMinimum,
  WALLET_CHAIN_NAMES,
  bridgeVenueDomain,
  endpointName,
  fundsKind,
  fundsRoute,
  isPerpEndpoint,
  presetRoute,
  stepsError,
  type FundsEndpoint,
  type FundsKind,
  type FundsStep,
  type WalletChain,
} from "@/lib/venues/bridge-routes";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId } from "@/lib/venues/types";
import { LighterFaucetButton } from "./lighter-faucet-button";
import { useTrading } from "./trading-provider";
import { useWalletModal } from "./wallet-modal";
import { useWallet } from "./wallet-provider";
import { useModalEnter } from "@/components/app/use-motion";

const ARRIVAL_POLL_MS = 10_000;
const ARRIVAL_TIMEOUT_MS = 12 * 60_000;
const FILL_POLL_MS = 4_000;
const FILL_TIMEOUT_MS = 15 * 60_000;
const QUOTE_DEBOUNCE_MS = 600;

/** Something the run waits on before its next step: Hyperliquid's withdrawal landing, or Across's relayer filling. */
type Wait =
  | { kind: "arrival"; before: bigint; expected: bigint; since: number }
  | { kind: "fill"; depositId: bigint; origin: SourceChain; to: SourceChain; before: bigint | null; expected: bigint; since: number };

/** A route being carried out: `carry` is what the next step moves (the previous step's output). */
interface Run {
  steps: FundsStep[];
  index: number;
  phase: "ready" | "busy" | "waiting" | "done";
  carry: bigint;
  wait?: Wait;
  explorerUrl?: string;
}

const units6 = (units: bigint) => Number(units) / 10 ** USDC_DECIMALS;
/** The wallet's icon, or a venue's logo (its site favicon through /api/favicon), its initial when that fails. */
function EndpointLogo({ endpoint, size = 18 }: { endpoint: FundsEndpoint; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (endpoint === "wallet") {
    return (
      <span aria-hidden className="grid shrink-0 place-items-center rounded-md bg-app-selected text-app-ink" style={{ width: size, height: size }}>
        <Wallet style={{ width: size * 0.65, height: size * 0.65 }} />
      </span>
    );
  }
  return failed ? (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-md bg-app-chip text-[10px] font-bold text-app-ink" style={{ width: size, height: size }}>
      {endpointName(endpoint).charAt(0)}
    </span>
  ) : (
    <img
      src={`/api/favicon?domain=${bridgeVenueDomain(endpoint)}`}
      alt=""
      aria-hidden
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-md object-contain"
      style={{ width: size, height: size }}
    />
  );
}

interface PickerOption<T> {
  value: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  note?: string;
}

/**
 * An inline dropdown that reads as a word in the sentence. The list is portaled to the body and fixed to the
 * viewport: inside the dialog its blur makes it the containing block and the scroll box clips it.
 */
function Picker<T extends string>({ value, options, onChange, label, disabled }: { value: T; options: Array<PickerOption<T>>; onChange: (value: T) => void; label: string; disabled?: boolean }) {
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLSpanElement>(null);
  const current = options.find((option) => option.value === value);
  const open = anchor !== null;
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => !ref.current?.contains(event.target as Node) && !listRef.current?.contains(event.target as Node) && setAnchor(null);
    // Only a scroll that moves the picker (the dialog, or the page under it) closes the list.
    const follow = (event: Event) => event.target instanceof Node && ref.current && event.target.contains(ref.current) && setAnchor(null);
    const dismiss = () => setAnchor(null);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);
  const toggle = () => {
    const rect = ref.current?.getBoundingClientRect();
    setAnchor(open || !rect ? null : { top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 184) });
  };
  return (
    <span ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
        className="inline-flex items-center gap-1.5 rounded-lg bg-app-chip py-0.5 pl-1.5 pr-2 font-semibold text-app-ink hover:bg-app-selected disabled:opacity-60 disabled:hover:bg-app-chip"
      >
        {current?.icon}
        {current?.label ?? value}
        <ChevronDown className="size-4 text-app-muted" aria-hidden />
      </button>
      {open &&
        createPortal(
          <span ref={listRef} role="listbox" style={anchor ?? undefined} className="surface-menu fixed z-50 flex w-44 flex-col rounded-xl border border-app-hairline-strong bg-app-dialog p-1 shadow-lg">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value);
                  setAnchor(null);
                }}
                className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] ${
                  option.value === value ? "bg-app-chip text-app-ink" : "text-app-ink hover:bg-app-chip"
                } disabled:cursor-default disabled:text-app-faint disabled:hover:bg-transparent`}
              >
                <span className="flex items-center gap-2">
                  {option.icon}
                  {option.label}
                </span>
                {option.note && <span className="text-[10px] font-semibold uppercase tracking-[0.06em]">{option.note}</span>}
              </button>
            ))}
          </span>,
          document.body,
        )}
    </span>
  );
}

function Tabs<T extends string>({ value, options, onChange, disabled }: { value: T | null; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-0.5 rounded-lg bg-app-chip p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`h-8 flex-1 rounded-md text-[12px] font-semibold disabled:opacity-60 ${value === option.value ? "bg-app-card text-app-ink shadow-xs" : "text-app-muted hover:text-app-ink"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const primaryButton = "h-10 rounded-lg bg-app-accent text-[13px] font-semibold text-app-on-accent disabled:opacity-50";
const TITLES: Record<FundsKind, string> = { deposit: "Deposit", withdraw: "Withdraw", move: "Bridge" };

function errorMessage(caught: unknown) {
  const message = caught instanceof Error ? caught.message.split("\n")[0] : String(caught);
  return /reject|denied/i.test(message) ? "You rejected the request in your wallet." : message;
}

/** One line per step, for the checklist and the continue button. */
function stepLabel(step: FundsStep) {
  if (step.kind === "hlWithdraw") return "Withdraw from Hyperliquid (signature, no gas, 1 USDC fee), lands on Arbitrum in 3-4 min";
  if (step.kind === "transfer") return `Deposit ${step.source.symbol} to ${PERP_VENUE_NAMES[step.venue]} from ${step.source.name} (a little ETH for gas)`;
  const change = step.from.symbol === step.to.symbol ? step.to.symbol : `${step.from.symbol} → ${step.to.symbol}`;
  const into = step.recipient === "wallet" ? `your wallet on ${step.to.name}` : PERP_VENUE_NAMES[step.recipient];
  return `Bridge with Across to ${into} (${change}, seconds; a little ETH on ${step.from.name} for gas)`;
}

function continueLabel(step: FundsStep, carry: bigint) {
  const amount = units6(carry).toFixed(2);
  if (step.kind === "transfer") return `Deposit ${amount} ${step.source.symbol} to ${PERP_VENUE_NAMES[step.venue]}`;
  if (step.kind === "across") return `Bridge ${amount} ${step.from.symbol} to ${step.recipient === "wallet" ? step.to.name : PERP_VENUE_NAMES[step.recipient]}`;
  return "Withdraw from Hyperliquid";
}

/**
 * Funds: "Move [amount] [token] from [endpoint] to [endpoint]" in one sentence, where an endpoint is a venue or the
 * wallet on a chain (USDC on Arbitrum or Base, USDG on Robinhood Chain). `fundsRoute` (`bridge-routes.ts`) turns the
 * pair into steps (a Hyperliquid withdrawal, an Across bridge that also swaps USDC ↔ USDG, a transfer into a venue)
 * and this window runs them in order: every step is one wallet signature, waits (the withdrawal landing, the relayer
 * filling) keep polling with the window closed, and the next step waits for a press. Testnets use faucets.
 */
export function DepositDialog() {
  const toast = useToast();
  const { depositVenue, depositMode, closeDeposit, openDeposit, network, accounts, withdrawHyperliquid } = useTrading();
  const { preferences } = usePreferences();
  const { address, wallet } = useWallet();
  const { open: openWallets } = useWalletModal();
  const [from, setFrom] = useState<FundsEndpoint>("wallet");
  const [to, setTo] = useState<FundsEndpoint>("hyperliquid");
  const [chains, setChains] = useState<{ from: WalletChain; to: WalletChain }>({ from: "arbitrum", to: "arbitrum" });
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<{ key: string; summary?: AcrossQuoteSummary; error?: string } | null>(null);
  const [run, setRun] = useState<Run | null>(null);

  const networkOf = (venue: PerpVenueId) => (isLighterVenue(venue) ? lighterConfigs[venue].network : network);
  const route = fundsRoute(from, to, chains, networkOf);
  const kind = fundsKind(route);
  const steps = route.kind === "steps" ? route.steps : [];
  const input = route.kind === "steps" ? route.input : null;
  const output = route.kind === "steps" ? route.output : null;
  const token = input?.symbol ?? "USDC";
  // A run in progress keeps its route until it finishes.
  const locked = run !== null && run.phase !== "done";
  const busy = run?.phase === "busy";
  const venueSide = isPerpEndpoint(to) ? to : isPerpEndpoint(from) ? from : null;
  const value = Number(amount);
  const units = usdcUnits(amount);
  const withdrawable = from === "hyperliquid" ? accounts.hyperliquid?.withdrawable : undefined;
  const fromWallet = from === "wallet" && input !== null;
  const error =
    route.kind !== "steps"
      ? null
      : (stepsError(steps, value, withdrawable, token) ??
        (fromWallet && units !== null && balance !== null && units > balance ? `Not enough ${token} in your wallet on ${input.name}.` : null));
  // The Across leg's quote preview: what it would pay out for this amount (after the withdrawal fee when it follows one).
  const acrossIndex = steps.findIndex((step) => step.kind === "across");
  const acrossStep = acrossIndex >= 0 ? (steps[acrossIndex] as Extract<FundsStep, { kind: "across" }>) : null;
  const acrossInput = acrossStep && units !== null ? (acrossIndex === 0 ? units : usdcUnits(String(Math.floor((value - HL_WITHDRAW_FEE_USDC) * 1e6) / 1e6))) : null;
  const quoteKey = acrossStep && acrossInput && acrossInput > 0n && address ? `${acrossStep.from.chainId}>${acrossStep.to.chainId}:${acrossStep.recipient}:${acrossInput}:${address}` : null;

  const enabled = (venue: PerpVenueId) =>
    venue === depositVenue || (venue === "hyperliquid" ? preferences.venueHyperliquid : venue === "lighter" ? preferences.venueLighter : preferences.venueLighterRh);
  const endpointOptions: Array<PickerOption<FundsEndpoint>> = [
    { value: "wallet", label: "Wallet", icon: <EndpointLogo endpoint="wallet" size={20} /> },
    ...BRIDGE_VENUES.filter((venue) => !venue.live || !isPerpEndpoint(venue.id) || enabled(venue.id) || venue.id === from || venue.id === to).map((venue) => ({
      value: venue.id,
      label: venue.name,
      icon: <EndpointLogo endpoint={venue.id} size={20} />,
      disabled: !venue.live,
      note: venue.live ? undefined : "Soon",
    })),
  ];
  const chainOptions: Array<PickerOption<WalletChain>> = WALLET_CHAINS.map((chain) => ({
    value: chain,
    label: WALLET_CHAIN_NAMES[chain],
    note: chain === "robinhood" ? "USDG" : "USDC",
  }));

  // Opening (or reopening on another venue) starts on the route the caller asked for, unless a run is under way.
  useEffect(() => {
    if (!depositVenue || locked) return;
    const preset = presetRoute(depositMode, depositVenue);
    setFrom(preset.from);
    setTo(preset.to);
    setChains(preset.chains);
    setAmount("");
    setRun(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the caller opens the window
  }, [depositVenue, depositMode]);

  useEffect(() => {
    if (!locked) setRun(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new route clears a finished run
  }, [from, to, chains.from, chains.to]);

  // The wallet's balance of the token the route starts with.
  useEffect(() => {
    setBalance(null);
    if (!address || !fromWallet || !input) return;
    let isActive = true;
    readUsdcBalance(input, address)
      .then((next) => isActive && setBalance(next))
      .catch(() => {});
    return () => {
      isActive = false;
    };
  }, [address, fromWallet, input]);

  // Debounced Across quote for the preview line.
  useEffect(() => {
    if (!quoteKey || !acrossStep || !acrossInput || !address || locked) return setQuote(null);
    let isActive = true;
    const timer = window.setTimeout(async () => {
      try {
        const recipient = acrossStep.recipient === "wallet" ? address : await lighterIntentAddress(lighterConfigs[acrossStep.recipient], acrossStep.to, address);
        const { fetchAcrossQuote } = await import("@/lib/venues/across-client");
        const result = await fetchAcrossQuote({ from: acrossStep.from, to: acrossStep.to, units: acrossInput, depositor: address, recipient });
        if (isActive) setQuote({ key: quoteKey, summary: summarizeAcrossQuote(result) });
      } catch (caught) {
        if (isActive) setQuote({ key: quoteKey, error: errorMessage(caught) });
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key covers every input
  }, [quoteKey, locked]);

  /** Moves to the step after `current` with `carry`, or finishes. */
  const advance = (current: Run, carry: bigint, explorerUrl?: string) => {
    const next = current.index + 1;
    if (next >= current.steps.length) {
      setRun({ ...current, phase: "done", carry, wait: undefined, explorerUrl: explorerUrl ?? current.explorerUrl });
      const last = current.steps[current.steps.length - 1];
      const where = last.kind === "transfer" ? PERP_VENUE_NAMES[last.venue] : last.kind === "across" && last.recipient !== "wallet" ? PERP_VENUE_NAMES[last.recipient] : "your wallet";
      toast({ tone: "success", title: "Funds moved", message: `${units6(carry).toFixed(2)} sent to ${where}.`, ...(explorerUrl && { link: { href: explorerUrl, label: "View transaction" } }) });
      return;
    }
    setRun({ ...current, index: next, phase: "ready", carry, wait: undefined, explorerUrl: explorerUrl ?? current.explorerUrl });
  };

  const execute = async (current: Run) => {
    if (!address || !wallet) return openWallets();
    const step = current.steps[current.index];
    setRun({ ...current, phase: "busy" });
    try {
      if (step.kind === "hlWithdraw") {
        const before = await readUsdcBalance(ARBITRUM, address);
        const expected = usdcUnits(String(Math.floor((units6(current.carry) - HL_WITHDRAW_FEE_USDC) * 1e6) / 1e6)) ?? 0n;
        if (!(await withdrawHyperliquid(String(units6(current.carry))))) return setRun(current.index === 0 ? null : { ...current, phase: "ready" });
        // A withdrawal straight to the wallet ends here (Hyperliquid pays out by itself and the provider says so).
        if (current.steps.length === 1) {
          setRun(null);
          return closeDeposit();
        }
        setRun({ ...current, phase: "waiting", wait: { kind: "arrival", before, expected, since: Date.now() } });
        return;
      }
      if (step.kind === "transfer") {
        const target = step.target === "bridge" ? HL_BRIDGE : await lighterIntentAddress(lighterConfigs[isLighterVenue(step.venue) ? step.venue : "lighter"], step.source, address);
        const result = await sendUsdc(wallet.provider, address, step.source, target, current.carry);
        return advance(current, current.carry, result.explorerUrl);
      }
      const recipient = step.recipient === "wallet" ? address : await lighterIntentAddress(lighterConfigs[step.recipient], step.to, address);
      const { fetchAcrossQuote, executeAcross } = await import("@/lib/venues/across-client");
      // Always a fresh quote right before signing: its transaction carries the amounts and a deadline.
      const fresh = await fetchAcrossQuote({ from: step.from, to: step.to, units: current.carry, depositor: address, recipient });
      const summary = summarizeAcrossQuote(fresh);
      if (!summary.executable) throw new Error("Across has no route for this amount right now.");
      if (summary.shortBalance) throw new Error(`Not enough ${step.from.symbol} in your wallet on ${step.from.name}.`);
      const minimum = acrossRecipientMinimum(step.recipient);
      if (summary.minOut < BigInt(minimum) * 10n ** BigInt(USDC_DECIMALS)) throw new Error(`${PERP_VENUE_NAMES[step.recipient as PerpVenueId]} needs at least ${minimum} ${step.to.symbol} after fees.`);
      const before = step.recipient === "wallet" ? await readUsdcBalance(step.to, address).catch(() => null) : null;
      const sent = await executeAcross(wallet.provider, address, step.from, step.to, fresh);
      setRun({
        ...current,
        phase: "waiting",
        explorerUrl: sent.explorerUrl,
        wait: { kind: "fill", depositId: sent.depositId, origin: step.from, to: step.to, before, expected: summary.expectedOut, since: Date.now() },
      });
    } catch (caught) {
      toast({ tone: "error", title: "Transfer not sent", message: errorMessage(caught) });
      setRun(current.index === 0 ? null : { ...current, phase: "ready" });
    }
  };

  // Waits keep polling with the window closed and say when the next step is ready.
  const waiting = run?.phase === "waiting" ? run : null;
  useEffect(() => {
    if (!waiting?.wait || !address) return;
    const current = waiting;
    const wait = waiting.wait;
    const resume = () => openDeposit(depositVenue ?? (isPerpEndpoint(to) ? to : "lighter"), "move");
    const timer = window.setInterval(
      async () => {
        if (wait.kind === "arrival") {
          const now = await readUsdcBalance(ARBITRUM, address).catch(() => null);
          if (now !== null && withdrawalArrived(wait.before, now, wait.expected)) {
            advance(current, wait.expected);
            toast({ tone: "info", title: "USDC arrived on Arbitrum", message: "Continue to finish the move.", action: { label: "Continue", onClick: resume }, durationMs: 15_000 });
          } else if (Date.now() - wait.since > ARRIVAL_TIMEOUT_MS) {
            toast({ tone: "error", title: "Withdrawal is taking longer than usual", message: "Check your wallet on Arbitrum, then continue from Funds." });
            setRun(null);
          }
          return;
        }
        const { acrossFilled } = await import("@/lib/venues/across-client");
        const state = await acrossFilled(wait.depositId, wait.origin.chainId).catch(() => "pending" as const);
        if (state === "filled") {
          let carry = wait.expected;
          if (wait.before !== null) {
            const now = await readUsdcBalance(wait.to, address).catch(() => null);
            // What actually arrived, never more than the quote (other funds landing at the same time stay put).
            if (now !== null && now > wait.before) carry = now - wait.before < wait.expected ? now - wait.before : wait.expected;
          }
          const last = current.index + 1 >= current.steps.length;
          advance(current, carry);
          if (!last) toast({ tone: "info", title: `Arrived on ${wait.to.name}`, message: "Continue to finish the move.", action: { label: "Continue", onClick: resume }, durationMs: 15_000 });
        } else if (state === "failed" || Date.now() - wait.since > FILL_TIMEOUT_MS) {
          toast({
            tone: "error",
            title: state === "failed" ? "Bridge refunded" : "Bridge is taking longer than usual",
            message: state === "failed" ? `Across returned the funds to your wallet on ${wait.origin.name}.` : "Check the transaction; Across refunds on the origin chain if it can't fill.",
            ...(current.explorerUrl && { link: { href: current.explorerUrl, label: "View transaction" } }),
          });
          setRun(null);
        }
      },
      wait.kind === "arrival" ? ARRIVAL_POLL_MS : FILL_POLL_MS,
    );
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one poller per wait
  }, [waiting?.wait, address]);

  const backdropRef = useModalEnter(depositVenue !== null);

  if (!depositVenue) return null;

  const pickFrom = (endpoint: FundsEndpoint) => {
    if (endpoint === to && endpoint !== "wallet") setTo(from);
    setFrom(endpoint);
  };
  const pickTo = (endpoint: FundsEndpoint) => {
    if (endpoint === from && endpoint !== "wallet") setFrom(to);
    setTo(endpoint);
  };
  const pickKind = (next: FundsKind) => {
    const preset = presetRoute(next, venueSide ?? depositVenue);
    setFrom(preset.from);
    setTo(preset.to);
    setChains(preset.chains);
  };
  const start = () => {
    if (!address) return openWallets();
    if (route.kind !== "steps" || error || units === null) return;
    void execute({ steps, index: 0, phase: "ready", carry: units });
  };

  const chainPicker = (side: "from" | "to") => (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      on
      <Picker label={side === "from" ? "From chain" : "To chain"} value={chains[side]} options={chainOptions} onChange={(chain) => setChains((current) => ({ ...current, [side]: chain }))} disabled={locked} />
    </span>
  );
  const fromName = endpointName(from);
  const toName = to === "wallet" ? WALLET_CHAIN_NAMES[chains.to] : endpointName(to);
  const quoteLine = quote && quote.key === quoteKey ? quote : null;
  const showSteps = steps.length > 1 || acrossStep !== null;
  const activeStep = run ? run.index : 0;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" ref={backdropRef} role="presentation" onClick={closeDeposit}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="deposit-title"
        onClick={(event) => event.stopPropagation()}
        className="surface-menu scrollbar-subtle max-h-[calc(100dvh-2rem)] overflow-y-auto flex w-full max-w-md flex-col gap-4 rounded-2xl border border-app-hairline-strong bg-app-card p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
      >
        <header className="flex items-center gap-3">
          <h2 id="deposit-title" className="flex-1 text-[16px] font-semibold text-app-ink">
            {kind ? TITLES[kind] : "Funds"}
          </h2>
          {venueSide && <span className="rounded-sm bg-app-chip px-1.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em] text-app-muted">{networkOf(venueSide)}</span>}
          <button type="button" onClick={closeDeposit} aria-label="Close" className="text-app-faint hover:text-app-ink">
            <X className="size-4" />
          </button>
        </header>

        <Tabs
          value={kind}
          disabled={locked}
          options={[
            { value: "deposit", label: "Deposit" },
            { value: "withdraw", label: "Withdraw" },
            { value: "move", label: "Bridge" },
          ]}
          onChange={pickKind}
        />

        <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5 text-[18px] leading-tight text-app-muted">
          Move
          {route.kind !== "faucet" && (
            <input
              aria-label={`${token} amount`}
              inputMode="decimal"
              placeholder="0"
              value={amount}
              disabled={locked}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
              className="w-24 rounded-lg border border-app-field-border bg-app-field px-2 py-0.5 text-[18px] font-semibold tabular-nums text-app-ink outline-hidden focus:border-app-ink"
            />
          )}
          {route.kind === "faucet" ? "test USDC from" : `${token} from`}
          <Picker label="From" value={from} options={endpointOptions} onChange={pickFrom} disabled={locked} />
          {from === "wallet" && chainPicker("from")}
          <button
            type="button"
            onClick={() => {
              setFrom(to);
              setTo(from);
              setChains({ from: chains.to, to: chains.from });
            }}
            disabled={locked}
            aria-label="Swap direction"
            title="Swap direction"
            className="grid size-7 place-items-center rounded-full border border-app-hairline-strong text-app-muted hover:text-app-ink disabled:opacity-40"
          >
            <ArrowLeftRight className="size-3.5" aria-hidden />
          </button>
          to
          <Picker label="To" value={to} options={endpointOptions} onChange={pickTo} disabled={locked} />
          {to === "wallet" && chainPicker("to")}
        </div>

        {fromWallet && balance !== null && !locked && (
          <button type="button" onClick={() => setAmount(units6(balance).toString())} className="-mt-1 self-start text-[12px] text-app-muted hover:text-app-ink">
            Wallet on {input.name} <span className="font-semibold text-app-ink">{formatPrice(units6(balance))}</span> · use max
          </button>
        )}
        {from === "hyperliquid" && withdrawable !== undefined && !locked && route.kind === "steps" && (
          <button type="button" onClick={() => setAmount(String(Math.floor(withdrawable * 100) / 100))} className="-mt-1 self-start text-[12px] text-app-muted hover:text-app-ink">
            Hyperliquid withdrawable <span className="font-semibold text-app-ink">{formatPrice(withdrawable)}</span> · use max
          </button>
        )}

        {route.kind === "same" && <p className="text-[13px] text-app-muted">Pick where the {token} goes.</p>}
        {route.kind === "testnet" && <p className="text-[13px] text-app-muted">Bridging works on mainnet. On testnet, get test funds from each venue&apos;s faucet.</p>}
        {route.kind === "soon" && (
          <p className="rounded-lg bg-app-chip/60 px-3 py-2.5 text-[12px] text-app-muted">
            {to === "wallet"
              ? `Withdrawing from ${fromName} here is coming soon. For now, withdraw in ${fromName}'s app.`
              : from === "wallet"
                ? `Deposits to ${toName} are coming soon.`
                : `${fromName} → ${toName} is coming soon. For now, withdraw from ${fromName} to your wallet and deposit to ${toName}.`}
          </p>
        )}

        {route.kind === "faucet" && (
          <div className="flex flex-col gap-2 text-[13px] text-app-muted">
            <p>{PERP_VENUE_NAMES[route.venue]} is on testnet: test USDC comes from its faucet, not from your wallet.</p>
            {route.venue === "lighter" && <LighterFaucetButton label="Get test USDC now" className={`inline-flex items-center justify-center hover:opacity-90 ${primaryButton}`} />}
            <a
              href={route.plan.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold ${
                route.venue === "lighter" ? "border border-app-hairline-strong text-app-ink hover:bg-app-chip" : "bg-app-accent text-app-on-accent"
              }`}
            >
              {route.plan.label} <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        )}

        {route.kind === "steps" && (
          <>
            {showSteps ? (
              <ol className="flex flex-col gap-1.5">
                {steps.map((step, index) => {
                  const done = run !== null && (index < activeStep || run.phase === "done");
                  const current = !done && index === activeStep;
                  return (
                    <li key={index} className={`flex items-start gap-2 text-[12px] ${current ? "font-semibold text-app-ink" : done ? "text-app-up" : "text-app-faint"}`}>
                      <span
                        className={`mt-px grid size-4 shrink-0 place-items-center rounded-full text-[10px] ${done ? "bg-app-up text-black" : current ? "bg-app-accent text-app-on-accent" : "bg-app-chip"}`}
                      >
                        {done ? "✓" : index + 1}
                      </span>
                      {stepLabel(step)}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-[12px] text-app-muted">
                {steps[0].kind === "hlWithdraw"
                  ? "Your wallet signs once (no gas). Hyperliquid sends it to your wallet on Arbitrum in 3-4 minutes and charges a 1 USDC fee."
                  : steps[0].kind === "transfer" && steps[0].target === "bridge"
                    ? `Sent to Hyperliquid's bridge contract; credited to this wallet in ${steps[0].arrival}. Less than ${steps[0].minimum} USDC is lost. A little ETH for gas.`
                    : steps[0].kind === "transfer"
                      ? `Sent to your ${PERP_VENUE_NAMES[steps[0].venue]} deposit address${steps[0].venue === "lighter" ? " (Circle CCTP)" : ""}; credited in ${steps[0].arrival}. Minimum ${steps[0].minimum} ${token}, a little gas from your wallet.`
                      : null}
              </p>
            )}

            {acrossStep && !locked && run?.phase !== "done" && quoteLine && (
              <p className={`text-[12px] ${quoteLine.error ? "text-app-down" : "text-app-muted"}`}>
                {quoteLine.error ??
                  (quoteLine.summary &&
                    `You receive ≈ ${units6(quoteLine.summary.expectedOut).toFixed(2)} ${acrossStep.to.symbol}${acrossStep.recipient === "wallet" ? "" : ` in ${PERP_VENUE_NAMES[acrossStep.recipient]}`} · bridge fee ${formatPrice(quoteLine.summary.feeUsd)} · ~${Math.max(1, quoteLine.summary.fillSeconds)}s`)}
              </p>
            )}
            {amount && error && !locked && <p className="text-[12px] text-app-down">{error}</p>}

            {(run === null || run.phase === "done") && (
              <button type="button" disabled={Boolean(address) && Boolean(error)} onClick={start} className={primaryButton}>
                {!address ? "Connect wallet" : `${kind ? TITLES[kind] : "Move"} ${amount || ""} ${token} to ${toName}`}
              </button>
            )}
            {run?.phase === "busy" && (
              <button type="button" disabled className={primaryButton}>
                Confirm in your wallet…
              </button>
            )}
            {run?.phase === "ready" && (
              <button type="button" disabled={busy} onClick={() => void execute(run)} className={primaryButton}>
                Continue: {continueLabel(run.steps[run.index], run.carry)}
              </button>
            )}
            {run?.phase === "waiting" && (
              <p className="text-[13px] text-app-ink">
                {run.wait?.kind === "arrival" ? "Waiting for the USDC to land on Arbitrum…" : `Across is filling on ${run.wait?.to.name}…`} You can close this window and keep trading;
                we&apos;ll tell you when it&apos;s there.
              </p>
            )}
            {run?.phase === "done" && run.explorerUrl && (
              <a href={run.explorerUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-app-up hover:underline">
                Done: {units6(run.carry).toFixed(2)} {output?.symbol} sent. View transaction
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
