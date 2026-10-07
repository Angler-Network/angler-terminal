"use client";

import { ArrowLeftRight, ChevronDown, ExternalLink, Wallet, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/app/toast-provider";
import { formatPrice } from "@/lib/format";
import { lighterIntentAddress, readUsdcBalance, sendUsdc } from "@/lib/venues/deposit-client";
import { isLighterVenue, lighterConfig, lighterConfigs } from "@/lib/venues/lighter/config";
import { usePreferences } from "@/components/app/preferences-provider";
import {
  ARBITRUM,
  HL_BRIDGE,
  HL_WITHDRAW_FEE_USDC,
  depositError,
  moveError,
  usdcUnits,
  USDC_DECIMALS,
  withdrawalArrived,
  type SourceChain,
} from "@/lib/venues/deposits";
import {
  BRIDGE_VENUES,
  bridgeVenueDomain,
  endpointName,
  fundsKind,
  fundsRoute,
  isPerpEndpoint,
  presetRoute,
  type FundsEndpoint,
  type FundsKind,
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

type MoveStep = { kind: "idle" } | { kind: "waiting"; before: bigint; units: bigint; since: number } | { kind: "arrived"; units: bigint } | { kind: "done"; explorerUrl: string };

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
  return caught instanceof Error ? caught.message.split("\n")[0] : String(caught);
}

/**
 * Funds: "Move [amount] USDC from [endpoint] to [endpoint]" in one sentence, where an endpoint is the wallet or a
 * venue (`bridge-routes.ts`). Wallet → venue deposits (an on-chain transfer the wallet signs; testnet: the venue's
 * faucet), Hyperliquid → wallet withdraws, Hyperliquid → Lighter bridges in two wallet signatures (withdraw to
 * Arbitrum, wait 3-4 min, deposit to the wallet's Lighter address). Other directions show as coming soon.
 */
export function DepositDialog() {
  const toast = useToast();
  const { depositVenue, depositMode, closeDeposit, openDeposit, network, accounts, withdrawHyperliquid } = useTrading();
  const { preferences } = usePreferences();
  const { address, wallet } = useWallet();
  const { open: openWallets } = useWalletModal();
  const [from, setFrom] = useState<FundsEndpoint>("wallet");
  const [to, setTo] = useState<FundsEndpoint>("hyperliquid");
  const [sourceIndex, setSourceIndex] = useState(0);
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ explorerUrl: string; arrival: string } | null>(null);
  const [step, setStep] = useState<MoveStep>({ kind: "idle" });

  const networkOf = (venue: PerpVenueId) => (isLighterVenue(venue) ? lighterConfigs[venue].network : network);
  const route = fundsRoute(from, to, networkOf);
  const kind = fundsKind(route);
  // A bridge waiting on its withdrawal keeps its route until the deposit is sent.
  const locked = step.kind === "waiting" || step.kind === "arrived";
  const venueSide = isPerpEndpoint(to) ? to : isPerpEndpoint(from) ? from : null;
  const plan = route.kind === "deposit" ? route.plan : null;
  const sources: SourceChain[] = plan?.kind === "transfer" ? plan.sources : route.kind === "withdraw" || route.kind === "move" ? [ARBITRUM] : [];
  const source = sources[sourceIndex] ?? sources[0] ?? null;
  const token = source?.symbol ?? "USDC";
  const units = usdcUnits(amount);
  const value = Number(amount);
  const withdrawable = isPerpEndpoint(from) ? accounts[from]?.withdrawable : undefined;
  const error =
    plan?.kind === "transfer"
      ? depositError(units, balance, plan.minimum, token)
      : route.kind === "withdraw"
        ? !(value > HL_WITHDRAW_FEE_USDC)
          ? `Withdraw more than the ${HL_WITHDRAW_FEE_USDC} USDC fee.`
          : withdrawable !== undefined && value > withdrawable
            ? "More than Hyperliquid can withdraw right now."
            : null
        : route.kind === "move"
          ? moveError(value, withdrawable)
          : null;

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

  // Opening (or reopening on another venue) starts on the route the caller asked for, unless a bridge is under way.
  useEffect(() => {
    if (!depositVenue || locked) return;
    const preset = presetRoute(depositMode, depositVenue);
    setFrom(preset.from);
    setTo(preset.to);
    setAmount("");
    setStep({ kind: "idle" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the caller opens the window
  }, [depositVenue, depositMode]);

  useEffect(() => {
    setDone(null);
    setSourceIndex(0);
  }, [from, to]);

  useEffect(() => {
    setBalance(null);
    if (!address || !source || plan?.kind !== "transfer") return;
    let isActive = true;
    readUsdcBalance(source, address)
      .then((next) => isActive && setBalance(next))
      .catch(() => {});
    return () => {
      isActive = false;
    };
  }, [address, source, plan?.kind]);

  // Keeps polling with the window closed, and says when the USDC has landed.
  useEffect(() => {
    if (step.kind !== "waiting" || !address) return;
    const timer = window.setInterval(async () => {
      const now = await readUsdcBalance(ARBITRUM, address).catch(() => null);
      if (now !== null && withdrawalArrived(step.before, now, step.units)) {
        setStep({ kind: "arrived", units: step.units });
        toast({ tone: "info", title: "USDC arrived on Arbitrum", message: "Deposit it to Lighter to finish the bridge.", action: { label: "Deposit", onClick: () => openDeposit("lighter", "move") }, durationMs: 15_000 });
      } else if (Date.now() - step.since > ARRIVAL_TIMEOUT_MS) {
        toast({ tone: "error", title: "Withdrawal is taking longer than usual", message: "Check your wallet on Arbitrum, then deposit to Lighter from Funds." });
        setStep({ kind: "idle" });
      }
    }, ARRIVAL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [step, address, toast, openDeposit]);

  const backdropRef = useModalEnter(depositVenue !== null);

  if (!depositVenue) return null;

  const pickFrom = (endpoint: FundsEndpoint) => {
    if (endpoint === to) setTo(from);
    setFrom(endpoint);
  };
  const pickTo = (endpoint: FundsEndpoint) => {
    if (endpoint === from) setFrom(to);
    setTo(endpoint);
  };
  const pickKind = (next: FundsKind) => {
    const preset = presetRoute(next, venueSide ?? depositVenue);
    setFrom(preset.from);
    setTo(preset.to);
  };

  const deposit = async () => {
    if (!address || !wallet) return openWallets();
    if (!source || plan?.kind !== "transfer" || units === null || error) return;
    const venue = plan.venue;
    setBusy(true);
    try {
      const target = plan.target === "bridge" ? HL_BRIDGE : await lighterIntentAddress(lighterConfigs[isLighterVenue(venue) ? venue : "lighter"], source, address);
      const result = await sendUsdc(wallet.provider, address, source, target, units);
      setDone({ explorerUrl: result.explorerUrl, arrival: plan.arrival });
      toast({ tone: "success", title: `Deposited ${amount} ${token}`, message: `Credited to ${PERP_VENUE_NAMES[venue]} in ${plan.arrival}.`, link: { href: result.explorerUrl, label: "View transaction" } });
    } catch (caught) {
      const message = errorMessage(caught);
      toast({ tone: "error", title: "Deposit not sent", message: /reject|denied/i.test(message) ? "You rejected the request in your wallet." : message });
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!address) return openWallets();
    if (error) return;
    setBusy(true);
    const ok = await withdrawHyperliquid(String(value));
    setBusy(false);
    if (ok) closeDeposit();
  };

  const startMove = async () => {
    if (!address) return openWallets();
    if (error) return;
    setBusy(true);
    try {
      const before = await readUsdcBalance(ARBITRUM, address);
      const expected = usdcUnits(String(Math.floor((value - HL_WITHDRAW_FEE_USDC) * 1e6) / 1e6)) ?? 0n;
      if (await withdrawHyperliquid(String(value))) setStep({ kind: "waiting", before, units: expected, since: Date.now() });
    } catch (caught) {
      toast({ tone: "error", title: "Couldn't start the bridge", message: errorMessage(caught) });
    } finally {
      setBusy(false);
    }
  };

  const finishMove = async (expected: bigint) => {
    if (!address || !wallet) return;
    setBusy(true);
    try {
      const target = await lighterIntentAddress(lighterConfig, ARBITRUM, address);
      const result = await sendUsdc(wallet.provider, address, ARBITRUM, target, expected);
      setStep({ kind: "done", explorerUrl: result.explorerUrl });
      toast({ tone: "success", title: "Bridged to Lighter", message: "Credited to your Lighter account in a few minutes.", link: { href: result.explorerUrl, label: "View transaction" } });
    } catch (caught) {
      const message = errorMessage(caught);
      toast({ tone: "error", title: "Deposit not sent", message: /reject|denied/i.test(message) ? "You rejected the request in your wallet. The USDC is in your wallet on Arbitrum." : message });
    } finally {
      setBusy(false);
    }
  };

  const chain =
    sources.length > 1 ? (
      <Picker
        label="Chain"
        value={String(sourceIndex)}
        options={sources.map((entry, index) => ({ value: String(index), label: entry.name }))}
        onChange={(next) => setSourceIndex(Number(next))}
        disabled={locked}
      />
    ) : (
      source && <span className="font-semibold text-app-ink">{source.name}</span>
    );
  const walletChain = (side: FundsEndpoint) =>
    side === "wallet" && source && (route.kind === "deposit" || route.kind === "withdraw") && <span className="inline-flex items-center gap-2 whitespace-nowrap">on {chain}</span>;

  const moveSteps = ["Withdraw from Hyperliquid (signature, no gas, 1 USDC fee)", "Arrives on Arbitrum in 3-4 minutes", "Deposit to Lighter (one transaction, a little ETH for gas)"];
  const moveIndex = step.kind === "idle" ? 0 : step.kind === "waiting" ? 1 : 2;
  const showAmount = plan?.kind !== "faucet";
  const fromName = endpointName(from);
  const toName = endpointName(to);

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
          {showAmount && (
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
          {showAmount ? `${token} from` : `test ${token} from`}
          <Picker label="From" value={from} options={endpointOptions} onChange={pickFrom} disabled={locked} />
          {walletChain(from)}
          <button
            type="button"
            onClick={() => {
              setFrom(to);
              setTo(from);
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
          {walletChain(to)}
        </div>

        {plan?.kind === "transfer" && balance !== null && (
          <button type="button" onClick={() => setAmount((Number(balance) / 10 ** USDC_DECIMALS).toString())} className="-mt-1 self-start text-[12px] text-app-muted hover:text-app-ink">
            Wallet on {source?.name} <span className="font-semibold text-app-ink">{formatPrice(Number(balance) / 10 ** USDC_DECIMALS)}</span> · use max
          </button>
        )}
        {(route.kind === "withdraw" || route.kind === "move") && withdrawable !== undefined && step.kind === "idle" && (
          <button type="button" onClick={() => setAmount(String(Math.floor(withdrawable * 100) / 100))} className="-mt-1 self-start text-[12px] text-app-muted hover:text-app-ink">
            {fromName} withdrawable <span className="font-semibold text-app-ink">{formatPrice(withdrawable)}</span> · use max
          </button>
        )}

        {route.kind === "same" && <p className="text-[13px] text-app-muted">Pick where the {token} goes.</p>}
        {route.kind === "testnet" && <p className="text-[13px] text-app-muted">The bridge works on mainnet. On testnet, get test USDC from each venue&apos;s faucet.</p>}
        {route.kind === "soon" && (
          <p className="rounded-lg bg-app-chip/60 px-3 py-2.5 text-[12px] text-app-muted">
            {to === "wallet"
              ? `Withdrawing from ${fromName} here is coming soon. For now, withdraw in ${fromName}'s app.`
              : from === "wallet"
                ? `Deposits to ${toName} are coming soon.`
                : `${fromName} → ${toName} is coming soon. For now, withdraw from ${fromName} to your wallet and deposit to ${toName}.`}
          </p>
        )}

        {plan?.kind === "faucet" && (
          <div className="flex flex-col gap-2 text-[13px] text-app-muted">
            <p>{PERP_VENUE_NAMES[plan.venue]} is on testnet: test USDC comes from its faucet, not from your wallet.</p>
            {plan.venue === "lighter" && <LighterFaucetButton label="Get test USDC now" className={`inline-flex items-center justify-center hover:opacity-90 ${primaryButton}`} />}
            <a
              href={plan.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold ${
                plan.venue === "lighter" ? "border border-app-hairline-strong text-app-ink hover:bg-app-chip" : "bg-app-accent text-app-on-accent"
              }`}
            >
              {plan.label} <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        )}

        {plan?.kind === "transfer" && (
          <>
            <p className="text-[12px] text-app-muted">
              {plan.target === "bridge"
                ? `Sent to Hyperliquid's bridge contract; credited to this wallet in ${plan.arrival}. Less than ${plan.minimum} USDC is lost.`
                : `Sent to your ${PERP_VENUE_NAMES[plan.venue]} deposit address${plan.venue === "lighter" ? " (Circle CCTP)" : ""}; credited in ${plan.arrival}.`}{" "}
              Minimum {plan.minimum} {token}, a little gas from your wallet.
            </p>
            {amount && error && <p className="text-[12px] text-app-down">{error}</p>}
            {done && (
              <a href={done.explorerUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-app-up hover:underline">
                Sent. Arrives in {done.arrival}. View transaction
              </a>
            )}
            <button type="button" disabled={busy || (Boolean(address) && Boolean(error))} onClick={() => void deposit()} className={primaryButton}>
              {!address ? "Connect wallet" : busy ? "Confirm in your wallet…" : `Deposit ${amount || ""} ${token} to ${toName}`}
            </button>
          </>
        )}

        {route.kind === "withdraw" && (
          <>
            <p className="text-[12px] text-app-muted">Your wallet signs once (no gas). Hyperliquid sends it in 3-4 minutes and charges a 1 USDC fee.</p>
            {amount && error && <p className="text-[12px] text-app-down">{error}</p>}
            <button type="button" disabled={busy || (Boolean(address) && Boolean(error))} onClick={() => void withdraw()} className={primaryButton}>
              {!address ? "Connect wallet" : busy ? "Confirm in your wallet…" : `Withdraw ${amount || ""} USDC to your wallet`}
            </button>
          </>
        )}

        {route.kind === "move" && (
          <>
            <ol className="flex flex-col gap-1.5">
              {moveSteps.map((label, index) => (
                <li key={label} className={`flex items-center gap-2 text-[12px] ${index === moveIndex ? "font-semibold text-app-ink" : index < moveIndex ? "text-app-up" : "text-app-faint"}`}>
                  <span
                    className={`grid size-4 shrink-0 place-items-center rounded-full text-[10px] ${
                      index < moveIndex ? "bg-app-up text-black" : index === moveIndex ? "bg-app-accent text-app-on-accent" : "bg-app-chip"
                    }`}
                  >
                    {index < moveIndex ? "✓" : index + 1}
                  </span>
                  {label}
                </li>
              ))}
            </ol>
            {amount && error && step.kind === "idle" && <p className="text-[12px] text-app-down">{error}</p>}
            {(step.kind === "idle" || step.kind === "done") && (
              <button
                type="button"
                disabled={busy || (Boolean(address) && Boolean(error))}
                onClick={() => {
                  setStep({ kind: "idle" });
                  void startMove();
                }}
                className={primaryButton}
              >
                {!address ? "Connect wallet" : busy ? "Confirm in your wallet…" : `Bridge ${amount || ""} USDC to ${toName}`}
              </button>
            )}
            {step.kind === "waiting" && <p className="text-[13px] text-app-ink">Waiting for the USDC to land on Arbitrum… You can close this window and keep trading; we&apos;ll tell you when it arrives.</p>}
            {step.kind === "arrived" && (
              <button type="button" disabled={busy} onClick={() => void finishMove(step.units)} className={primaryButton}>
                {busy ? "Confirm in your wallet…" : `Deposit ${(Number(step.units) / 10 ** USDC_DECIMALS).toFixed(2)} USDC to Lighter`}
              </button>
            )}
            {step.kind === "done" && (
              <a href={step.explorerUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-app-up hover:underline">
                Sent to Lighter. Arrives in a few minutes. View transaction
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
