"use client";

import { useRouter } from "next/navigation";
import { openBridge } from "./bridge-shortcut";
import { ArrowLeftRight, ExternalLink, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { CoinIcon, stableLogo } from "./token-icon";
import { Picker, type PickerOption } from "./inline-picker";
import { formatPrice } from "@/lib/format";
import { lighterIntentAddress, readUsdcBalance } from "@/lib/venues/deposit-client";
import { isLighterVenue, lighterConfigs } from "@/lib/venues/lighter/config";
import { usePreferences } from "@/components/app/preferences-provider";
import { HL_WITHDRAW_FEE_USDC, usdcUnits, type SourceChain } from "@/lib/venues/deposits";
import { summarizeAcrossQuote, type AcrossQuoteSummary } from "@/lib/venues/across";
import {
  BRIDGE_VENUES,
  WALLET_CHAINS,
  walletChainSource,
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
import { continueLabel, errorMessage, stepLabel, units6, useFundsRun } from "./use-funds-run";
import { useModalEnter } from "@/components/app/use-motion";

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
const TITLES: Record<FundsKind, string> = { deposit: "Deposit", withdraw: "Withdraw", move: "Move" };


/**
 * Deposit / Withdraw: "Move [amount] [token] from [endpoint] to [endpoint]" in one sentence, where an endpoint is a
 * venue or the wallet on a chain (USDC on Arbitrum, Base or Ethereum, USDG on Robinhood Chain). Wallet to wallet hands
 * over to the swap card (`bridge-shortcut.ts`), which bridges any token. `fundsRoute` (`bridge-routes.ts`) turns the
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
  const [chains, setChains] = useState<{ from: WalletChain; to: WalletChain }>({ from: "arbitrum", to: "arbitrum" });
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<{ key: string; summary?: AcrossQuoteSummary; error?: string } | null>(null);
  const { run, setRun, execute } = useFundsRun({
    resume: () => openDeposit(depositVenue ?? (isPerpEndpoint(to) ? to : "lighter"), "move"),
    onWithdrawOnly: closeDeposit,
  });

  const router = useRouter();
  const walletToWallet = from === "wallet" && to === "wallet";
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
      note: !venue.live ? "Soon" : isPerpEndpoint(venue.id) ? venueToken(venue.id) : undefined,
    })),
  ];
  // The wallet side is a stablecoin on a chain: the user picks what they send or want to receive.
  const chainOptions: Array<PickerOption<WalletChain>> = WALLET_CHAINS.map((chain) => {
    const token = walletChainSource(chain);
    return { value: chain, label: `${token.symbol} · ${WALLET_CHAIN_NAMES[chain]}`, icon: <TokenIcon token={token} size={20} /> };
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
    />
  );
  const fromName = endpointName(from);
  const venueSource = input ?? walletChainSource(from === "lighterRh" ? "robinhood" : "arbitrum");
  const toName = to === "wallet" ? WALLET_CHAIN_NAMES[chains.to] : endpointName(to);
  const quoteLine = quote && quote.key === quoteKey ? quote : null;
  // Send / receive card: what leaves, what arrives (after Hyperliquid's fee and Across's quote), and any conversion.
  const converted = input !== null && output !== null && input.symbol !== output.symbol;
  const receive =
    route.kind !== "steps" || !(value > 0)
      ? null
      : acrossStep
        ? quoteLine?.summary
          ? units6(quoteLine.summary.expectedOut)
          : null
        : steps[0].kind === "hlWithdraw"
          ? Math.max(0, value - HL_WITHDRAW_FEE_USDC)
          : value;
  const sendWhere = from === "wallet" && input ? `Wallet · ${input.name}` : fromName;
  const receiveWhere = to === "wallet" && output ? `Wallet · ${output.name}` : toName;
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
            { value: "move", label: "Between venues" },
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
          {route.kind === "faucet" ? (
            "test USDC"
          ) : from === "wallet" ? (
            chainPicker("from")
          ) : (
            // A venue holds one stablecoin, so its side shows the token instead of a picker.
            <span className="inline-flex items-center gap-1.5 font-semibold text-app-ink">
              <TokenIcon token={venueSource} size={20} showChain={false} />
              {venueSource.symbol}
            </span>
          )}
          from
          <Picker label="From" value={from} options={endpointOptions} onChange={pickFrom} disabled={locked} />
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

            {input && output && value > 0 && (
              <div className="flex flex-col gap-2 rounded-xl border border-app-hairline bg-app-chip/40 p-3 text-[13px]">
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[12px] text-app-muted">You send</span>
                  <TokenIcon token={input} />
                  <span className="font-semibold tabular-nums text-app-ink">
                    {value.toFixed(2)} {input.symbol}
                  </span>
                  <span className="ml-auto truncate text-[12px] text-app-muted">{sendWhere}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[12px] text-app-muted">You receive</span>
                  <TokenIcon token={output} />
                  <span className="font-semibold tabular-nums text-app-ink">
                    {receive === null ? (quoteLine?.error ? "—" : "…") : `≈ ${receive.toFixed(2)}`} {output.symbol}
                  </span>
                  <span className="ml-auto truncate text-[12px] text-app-muted">{receiveWhere}</span>
                </div>
                {converted && (
                  <p className="text-[12px] text-app-ink">
                    Your {input.symbol} is converted to {output.symbol} on the way, about 1:1 ({output.symbol} is {TOKEN_ABOUT[output.symbol] ?? "a dollar stablecoin"}).
                  </p>
                )}
                {acrossStep && quoteLine?.error && <p className="text-[12px] text-app-down">{quoteLine.error}</p>}
                {acrossStep && quoteLine?.summary && (
                  <p className="text-[11px] text-app-muted">
                    {converted ? "Bridge and conversion" : "Bridge"} by Across · fee {quoteLine.summary.feeUsd < 0.01 ? "< $0.01" : `$${quoteLine.summary.feeUsd.toFixed(2)}`} · ~{Math.max(1, quoteLine.summary.fillSeconds)}s
                    {steps[0].kind === "hlWithdraw" ? " · after Hyperliquid's 1 USDC withdrawal fee" : ""}
                  </p>
                )}
              </div>
            )}
            {amount && error && !locked && <p className="text-[12px] text-app-down">{error}</p>}

            {walletToWallet && (run === null || run.phase === "done") ? (
              // Wallet to wallet is a cross-chain swap now: the swap card bridges dollars and tokens alike.
              <div className="flex flex-col gap-2 rounded-xl border border-app-hairline bg-app-chip/40 p-3 text-[12px] text-app-ink">
                Moving dollars between your own wallets on different chains is done in Swap now, where any token can come along.
                <button
                  type="button"
                  onClick={() => {
                    closeDeposit();
                    openBridge(router.push, chains.from, chains.to);
                  }}
                  className={primaryButton}
                >
                  Open in Swap: {WALLET_CHAIN_NAMES[chains.from]} → {WALLET_CHAIN_NAMES[chains.to]}
                </button>
              </div>
            ) : (run === null || run.phase === "done") && (
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
