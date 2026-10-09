"use client";


import { ArrowDown, ExternalLink, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { CoinIcon, stableLogo } from "./token-icon";
import { Picker, type PickerOption } from "./inline-picker";
import { amountSize, pillClass } from "./swap-card";
import { formatPrice } from "@/lib/format";
import { lighterIntentAddress, readUsdcBalance } from "@/lib/venues/deposit-client";
import { isLighterVenue, lighterConfigs } from "@/lib/venues/lighter/config";
import { usePreferences } from "@/components/app/preferences-provider";
import { HL_WITHDRAW_FEE_USDC, decimalsOf, fromTokenUnits, tokenUnits, usdcUnits, type SourceChain } from "@/lib/venues/deposits";
import type { BridgeLegQuote, BridgeProvider } from "@/lib/venues/bridge-leg";
import {
  BRIDGE_VENUES,
  FUNDS_CHAINS,
  fundsChainSource,
  walletChainSource,
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
  type FundsChain,
} from "@/lib/venues/bridge-routes";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId } from "@/lib/venues/types";
import { LighterFaucetButton } from "./lighter-faucet-button";
import { useTrading } from "./trading-provider";
import { useWalletModal } from "./wallet-modal";
import { useWallet } from "./wallet-provider";
import { continueLabel, errorMessage, stepLabel, useFundsRun } from "./use-funds-run";
import { useModalEnter } from "@/components/app/use-motion";

/** Kept here so the dialog doesn't import the bridge clients up front. */
const PROVIDER_NAMES: Record<BridgeProvider, string> = { across: "Across", relay: "Relay", lifi: "LI.FI" };

const QUOTE_DEBOUNCE_MS = 600;


const TOKEN_ABOUT: Record<string, string> = { USDC: "Circle's dollar", USDG: "Paxos's Global Dollar, the dollar Robinhood Chain venues use" };

/** A stablecoin on its chain: the token's logo with the chain's logo in the corner. */
function TokenIcon({ token, size = 18, showChain = true }: { token: SourceChain; size?: number; showChain?: boolean }) {
  return <CoinIcon src={stableLogo(token.symbol)} symbol={token.symbol} chain={showChain ? token.chainId : undefined} size={size} />;
}

/** What a venue holds its margin in. */
const venueToken = (venue: PerpVenueId) => (isLighterVenue(venue) ? lighterConfigs[venue].collateral : "USDC");
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


/**
 * Funds (Deposit / Withdraw / Bridge): "Move [amount] [token] from [endpoint] to [endpoint]" in one sentence, where an
 * endpoint is a venue or the wallet on a chain (USDC on Arbitrum, Base or Ethereum, USDG on Robinhood Chain). Every
 * bridge leg takes the best of Across, Relay and LI.FI (`bridge-leg.ts`). `fundsRoute` (`bridge-routes.ts`) turns the
 * pair into steps (a Hyperliquid withdrawal, an Across bridge that also swaps USDC ↔ USDG, a transfer into a venue)
 * and this window runs them in order: every step is one wallet signature, waits (the withdrawal landing, the relayer
 * filling) keep polling with the window closed, and the next step waits for a press. Testnets use faucets.
 */
export function DepositDialog() {
  const { depositVenue, depositMode, closeDeposit, openDeposit, network, accounts } = useTrading();
  const { preferences } = usePreferences();
  const { address } = useWallet();
  const { open: openWallets } = useWalletModal();
  const [from, setFrom] = useState<FundsEndpoint>("wallet");
  const [to, setTo] = useState<FundsEndpoint>("hyperliquid");
  const [chains, setChains] = useState<{ from: FundsChain; to: FundsChain }>({ from: "arbitrum", to: "arbitrum" });
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<{ key: string; summary?: BridgeLegQuote; error?: string } | null>(null);
  const { run, setRun, execute } = useFundsRun({
    resume: () => openDeposit(depositVenue ?? (isPerpEndpoint(to) ? to : "lighter"), "move"),
    onWithdrawOnly: closeDeposit,
  });

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
  // In the token the route starts with (BNB Chain's USDT has 18 decimals).
  const units = tokenUnits(amount, input ? decimalsOf(input) : 6);
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
    venue === depositVenue ||
    (venue === "hyperliquid" ? preferences.venueHyperliquid : venue === "lighter" ? preferences.venueLighter : venue === "aster" ? preferences.venueAster : venue === "orderly" ? preferences.venueOrderly : preferences.venueLighterRh);
  const endpointOptions: Array<PickerOption<FundsEndpoint>> = [
    { value: "wallet", label: "Wallet", icon: <EndpointLogo endpoint="wallet" size={20} /> },
    ...BRIDGE_VENUES.filter((venue) => !venue.live || !isPerpEndpoint(venue.id) || enabled(venue.id) || venue.id === from || venue.id === to).map((venue) => ({
      value: venue.id,
      label: venue.name,
      icon: <EndpointLogo endpoint={venue.id} size={20} />,
      disabled: !venue.live,
      note: !venue.live ? "Soon" : isPerpEndpoint(venue.id) ? venueToken(venue.id) : undefined,
    })),
  ];
  // The wallet side is a stablecoin on a chain: the user picks what they send or want to receive.
  const chainOptions: Array<PickerOption<FundsChain>> = FUNDS_CHAINS.map((chain) => {
    const token = fundsChainSource(chain);
    return { value: chain, label: `${token.symbol} · ${token.name}`, icon: <TokenIcon token={token} size={20} /> };
  });

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

  // The wallet's balance of the token arriving on the To side (a wallet destination).
  const [toBalance, setToBalance] = useState<bigint | null>(null);
  const toWallet = to === "wallet" && output !== null;
  useEffect(() => {
    setToBalance(null);
    if (!address || !toWallet || !output) return;
    let isActive = true;
    readUsdcBalance(output, address)
      .then((next) => isActive && setToBalance(next))
      .catch(() => {});
    return () => {
      isActive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the chain and token decide it
  }, [address, toWallet, output?.chainId, output?.usdc]);

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

  // Debounced bridge quotes (Across, Relay and LI.FI, the best one) for the preview line.
  useEffect(() => {
    if (!quoteKey || !acrossStep || !acrossInput || !address || locked) return setQuote(null);
    let isActive = true;
    const timer = window.setTimeout(async () => {
      try {
        const recipient = acrossStep.recipient === "wallet" ? address : await lighterIntentAddress(lighterConfigs[acrossStep.recipient], acrossStep.to, address);
        const { quoteBridgeLeg, noRouteReason } = await import("@/lib/venues/bridge-leg");
        const result = await quoteBridgeLeg({ from: acrossStep.from, to: acrossStep.to, units: acrossInput, depositor: address, recipient });
        if (isActive) setQuote(result.best ? { key: quoteKey, summary: result.best } : { key: quoteKey, error: noRouteReason(result) });
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
    <Picker
      label={side === "from" ? "Send token" : "Receive token"}
      value={chains[side]}
      options={chainOptions}
      onChange={(chain) => setChains((current) => ({ ...current, [side]: chain }))}
      disabled={locked}
      buttonClassName={`${pillClass} hover:bg-app-selected disabled:opacity-60`}
    />
  );
  const fromName = endpointName(from);
  const venueSource = input ?? walletChainSource(from === "lighterRh" ? "robinhood" : "arbitrum");
  const toName = to === "wallet" ? fundsChainSource(chains.to).name : endpointName(to);
  const quoteLine = quote && quote.key === quoteKey ? quote : null;
  // Send / receive card: what leaves, what arrives (after Hyperliquid's fee and Across's quote), and any conversion.
  const converted = input !== null && output !== null && input.symbol !== output.symbol;
  const receive =
    route.kind !== "steps" || !(value > 0)
      ? null
      : acrossStep
        ? quoteLine?.summary
          ? fromTokenUnits(quoteLine.summary.expectedOut, decimalsOf(acrossStep.to))
          : null
        : steps[0].kind === "hlWithdraw"
          ? Math.max(0, value - HL_WITHDRAW_FEE_USDC)
          : value;
  const showSteps = steps.length > 1 || acrossStep !== null;
  // What the From side holds: the wallet's balance of the token, or what Hyperliquid lets you withdraw.
  const destination =
    to === "wallet" ? (toBalance !== null && output ? fromTokenUnits(toBalance, decimalsOf(output)) : null) : isPerpEndpoint(to) ? (accounts[to]?.withdrawable ?? null) : null;
  const available = fromWallet && balance !== null ? fromTokenUnits(balance, decimalsOf(input)) : from === "hyperliquid" && withdrawable !== undefined ? withdrawable : null;
  const box = "flex flex-col gap-2 rounded-2xl border border-app-hairline bg-app-chip/30 p-3";
  const endpointPill =
    "inline-flex h-7 items-center gap-1.5 rounded-full bg-app-chip pl-1 pr-2 text-[13px] font-semibold text-app-ink hover:bg-app-selected disabled:opacity-60 disabled:hover:bg-app-chip";
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

        {/* Like the swap card: what leaves (From), a flip, what arrives (To). */}
        <div className="relative flex flex-col gap-1">
          <div className={box}>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-app-muted">From</span>
              <Picker label="From" value={from} options={endpointOptions} onChange={pickFrom} disabled={locked} buttonClassName={endpointPill} />
              <span className="ml-auto">
                {from === "wallet" ? (
                  chainPicker("from")
                ) : (
                  // A venue holds one stablecoin, so its side shows the token instead of a picker.
                  <span className={pillClass}>
                    <TokenIcon token={venueSource} size={22} showChain={false} />
                    {venueSource.symbol}
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {route.kind === "faucet" ? (
                <span className="min-w-0 flex-1 text-[15px] font-semibold text-app-muted">Test USDC from the faucet</span>
              ) : (
                <input
                  aria-label={`${token} amount`}
                  inputMode="decimal"
                  placeholder="0"
                  value={amount}
                  disabled={locked}
                  onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
                  className={`min-w-0 flex-1 bg-transparent ${amountSize(amount)} font-semibold tabular-nums text-app-ink outline-hidden placeholder:text-app-faint`}
                />
              )}
              {available !== null && route.kind === "steps" && (
                <span className="shrink-0 text-right text-[12px] text-app-faint">
                  {from === "hyperliquid" ? "Withdrawable" : "Balance"} <span className="font-semibold tabular-nums text-app-ink">{formatPrice(available)}</span>
                </span>
              )}
            </div>
            {route.kind !== "faucet" && (
              <div className="flex items-center gap-1.5 text-[12px]">
                <span className="mr-auto tabular-nums text-app-faint">{value > 0 ? `≈ ${formatPrice(value)}` : "$0.00"}</span>
                {!locked &&
                  available !== null &&
                  route.kind === "steps" &&
                  [25, 50, 75, 100].map((share) => (
                    <button
                      key={share}
                      type="button"
                      onClick={() => setAmount(String(Math.floor(((available * share) / 100) * 100) / 100))}
                      className="h-6 rounded-full bg-app-chip px-2 text-[11px] font-semibold text-app-muted hover:text-app-ink"
                    >
                      {share === 100 ? "Max" : `${share}%`}
                    </button>
                  ))}
              </div>
            )}
          </div>
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
            className="absolute left-1/2 top-1/2 z-10 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-lg border border-app-hairline-strong bg-app-card text-app-muted hover:text-app-ink disabled:opacity-40"
          >
            <ArrowDown className="size-4" aria-hidden />
          </button>
          <div className={box}>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-app-muted">To</span>
              <Picker label="To" value={to} options={endpointOptions} onChange={pickTo} disabled={locked} buttonClassName={endpointPill} />
              <span className="ml-auto">
                {to === "wallet" ? (
                  chainPicker("to")
                ) : output ? (
                  <span className={pillClass}>
                    <TokenIcon token={output} size={22} showChain={false} />
                    {output.symbol}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`min-w-0 flex-1 truncate ${amountSize(receive !== null ? receive.toFixed(2) : "0")} font-semibold tabular-nums ${receive !== null ? "text-app-ink" : "text-app-faint"}`}>
                {receive !== null ? receive.toFixed(2) : value > 0 && acrossStep && !quoteLine?.error ? "…" : "0"}
              </span>
              {destination !== null && (
                <span className="shrink-0 text-right text-[12px] text-app-faint">
                  Balance <span className="font-semibold tabular-nums text-app-ink">{formatPrice(destination)}</span>
                </span>
              )}
            </div>
            <span className="text-[12px] text-app-faint">{output ? `Arrives ${to === "wallet" ? `in your wallet on ${output.name}` : `in your ${toName} account`}` : `To ${toName}`}</span>
          </div>
        </div>

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

            {input && output && value > 0 && (converted || acrossStep) && (
              <div className="flex flex-col gap-1.5 rounded-xl border border-app-hairline px-3 py-2.5 text-[12px]">
                {acrossStep && quoteLine?.summary && (
                  <>
                    <div className="flex justify-between gap-3 text-app-muted">
                      Route
                      <span className="text-right text-app-ink">
                        {PROVIDER_NAMES[quoteLine.summary.provider]} <span className="text-app-faint">(best of Across, Relay, LI.FI)</span>
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 text-app-muted">
                      Fee
                      <span className="tabular-nums text-app-ink">
                        {quoteLine.summary.feeUsd < 0.01 ? "< $0.01" : `$${quoteLine.summary.feeUsd.toFixed(2)}`}
                        {steps[0].kind === "hlWithdraw" ? ` + ${HL_WITHDRAW_FEE_USDC} USDC withdrawal` : ""}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 text-app-muted">
                      Time
                      <span className="tabular-nums text-app-ink">~{Math.max(1, quoteLine.summary.fillSeconds)}s</span>
                    </div>
                  </>
                )}
                {acrossStep && quoteLine?.error && <p className="text-app-down">{quoteLine.error}</p>}
                {converted && (
                  <p className="text-app-ink">
                    Your {input.symbol} is converted to {output.symbol} on the way, about 1:1 ({output.symbol} is {TOKEN_ABOUT[output.symbol] ?? "a dollar stablecoin"}).
                  </p>
                )}
              </div>
            )}
            {amount && error && !locked && <p className="text-[12px] text-app-down">{error}</p>}

            {(run === null || run.phase === "done") && (
              <button type="button" disabled={Boolean(address) && Boolean(error)} onClick={start} className={primaryButton}>
                {!address ? "Connect wallet" : `${kind ? TITLES[kind] : "Move"} ${amount || ""} ${converted ? `${token} → ${output?.symbol}` : token} to ${toName}`}
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
                {run.wait?.kind === "arrival" ? "Waiting for the USDC to land on Arbitrum…" : `The bridge is filling on ${run.wait?.to.name}…`} You can close this window and keep trading;
                we&apos;ll tell you when it&apos;s there.
              </p>
            )}
            {run?.phase === "done" && run.explorerUrl && (
              <a href={run.explorerUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-app-up hover:underline">
                Done: {fromTokenUnits(run.carry, output ? decimalsOf(output) : 6).toFixed(2)} {output?.symbol} sent. View transaction
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
