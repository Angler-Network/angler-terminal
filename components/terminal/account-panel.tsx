"use client";

import { ExternalLink, KeyRound } from "lucide-react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { useCallback, useEffect, useState } from "react";
import { formatPrice } from "@/lib/format";
import { robinhoodSources } from "@/lib/venues/robinhood-sources";
import { fromBaseUnits } from "@/lib/venues/jupiter/amounts";
import { ROBINHOOD_TESTNET_FAUCET_URL, TEST_USDG_MINT_AMOUNT, arcusConfig } from "@/lib/venues/arcus/config";
import type { ArcusToken } from "@/lib/venues/arcus/tokens";
import { arcusQuoteToken } from "@/lib/venues/arcus/catalog";
import { lighterConfigs, type LighterVenueId } from "@/lib/venues/lighter/config";
import { ASTER_APP_URL } from "@/lib/venues/aster/config";
import { orderlyConfig } from "@/lib/venues/orderly/config";
import { extendedConfig } from "@/lib/venues/extended/config";
import type { PerpVenueId } from "@/lib/venues/types";
import { USDC_MINT } from "@/lib/venues/jupiter/config";
import { jupiterVenue } from "@/lib/venues/jupiter/venue";
import { LighterFaucetButton } from "./lighter-faucet-button";
import { OrderPanel } from "./order-panel";
import dynamic from "next/dynamic";
import type { SpotBalances } from "@/lib/venues/types";
import { useSelectedAsset } from "./selected-asset";
import { useSolanaWallet } from "./solana-wallet-provider";
import { useTrading } from "./trading-provider";
import { useArcusToken } from "./use-arcus-token";
import { useAssetVenues } from "./use-asset-venue";
import { useWallet } from "./wallet-provider";
import { usePathname } from "next/navigation";
import { terminalKindOf } from "@/lib/terminal-kind";

// The order-book spot form loads on /spot only.
const SpotOrderPanel = dynamic(() => import("./spot-order-panel").then((module) => module.SpotOrderPanel));

const BALANCE_REFRESH_MS = 15_000;

function Section({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-app-hairline p-3 last:border-b-0">
      <header className="flex items-center gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-app-muted">{title}</h3>
        {badge && <span className="ml-auto rounded-sm bg-app-chip px-1.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em] text-app-muted">{badge}</span>}
      </header>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-app-muted">{label}</span>
      <span className="tabular-nums text-app-ink">{children}</span>
    </div>
  );
}


function TradingKeyStatus() {
  const { onboarding, revoke, openSetup } = useTrading();
  const [isRevoking, setIsRevoking] = useState(false);
  if (!onboarding) return null;
  if (onboarding.agentAddress) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-app-hairline px-2.5 py-2 text-[12px]">
        <KeyRound className="size-3.5 text-app-up" aria-hidden />
        <span className="font-medium text-app-ink" title={onboarding.agentAddress}>
          Trading key active
        </span>
        <button
          type="button"
          disabled={isRevoking}
          onClick={async () => {
            setIsRevoking(true);
            await revoke();
            setIsRevoking(false);
          }}
          className="ml-auto font-semibold text-app-down hover:underline disabled:opacity-60"
        >
          {isRevoking ? "Revoking…" : "Revoke"}
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => openSetup("hyperliquid")}
      className="flex items-center gap-2 rounded-lg border border-dashed border-app-hairline-strong px-2.5 py-2 text-left text-[12px] text-app-muted hover:text-app-ink"
    >
      <KeyRound className="size-3.5" aria-hidden />
      No trading key yet. Set up trading
    </button>
  );
}

function FundsButton({ venue }: { venue: PerpVenueId }) {
  const { openDeposit } = useTrading();
  return (
    <button
      type="button"
      onClick={() => openDeposit(venue)}
      className="h-7 rounded-md border border-app-hairline-strong bg-app-chip text-[12px] font-semibold text-app-ink hover:bg-app-card"
    >
      {venue === "hyperliquid" ? "Deposit / Withdraw" : "Deposit"}
    </button>
  );
}

function HyperliquidSection() {
  const { accounts, network } = useTrading();
  const account = accounts.hyperliquid ?? null;
  return (
    <Section title="Hyperliquid perps" badge={network === "testnet" ? "Testnet" : "Mainnet"}>
      <Row label="Account value">{account ? formatPrice(account.accountValue) : "—"}</Row>
      <Row label="Withdrawable">{account ? formatPrice(account.withdrawable) : "—"}</Row>
      <FundsButton venue="hyperliquid" />
      <TradingKeyStatus />
    </Section>
  );
}

/** Setup state of one Lighter exchange (core or Robinhood): account, browser key, integrator approval. */
function LighterKeyStatus({ venue }: { venue: LighterVenueId }) {
  const { lighterStates, revokeLighter, openSetup, openDeposit } = useTrading();
  const config = lighterConfigs[venue];
  const lighter = lighterStates[venue];
  const [isRevoking, setIsRevoking] = useState(false);
  if (!lighter) return <p className="text-[12px] text-app-faint">Checking {config.name} account…</p>;
  if (lighter.accountIndex === null && venue === "lighter" && config.network === "testnet") {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[12px] text-app-muted">No Lighter testnet account yet. The faucet opens one with test USDC.</p>
        <LighterFaucetButton
          label="Open account with test USDC"
          className="h-7 rounded-md bg-app-accent text-[12px] font-semibold text-app-on-accent hover:opacity-90 disabled:opacity-60"
        />
      </div>
    );
  }
  if (lighter.accountIndex === null && (config.collateral === "USDG" || !config.appUrl)) {
    // Lighter on Robinhood: the first USDG deposit (from Robinhood Chain, or USDC bridged by the funds window) opens the
    // account, so the terminal's own deposit is the way in.
    return (
      <button
        type="button"
        onClick={() => openDeposit(venue)}
        className="flex items-center gap-2 rounded-lg border border-dashed border-app-hairline-strong px-2.5 py-2 text-left text-[12px] text-app-muted hover:text-app-ink"
      >
        <ExternalLink className="size-3.5" aria-hidden />
        No {config.name} account yet. Deposit {config.collateral} to open one
      </button>
    );
  }
  if (lighter.accountIndex === null) {
    return (
      <a
        href={config.appUrl ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded-lg border border-dashed border-app-hairline-strong px-2.5 py-2 text-[12px] text-app-muted hover:text-app-ink"
      >
        <ExternalLink className="size-3.5" aria-hidden />
        No Lighter account yet. Deposit USDC on Lighter
      </a>
    );
  }
  if (lighter.keyReady && lighter.integrator !== "needed") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-app-hairline px-2.5 py-2 text-[12px]">
        <KeyRound className="size-3.5 text-app-up" aria-hidden />
        <span className="font-medium text-app-ink" title={`Account ${lighter.accountIndex}, key index ${config.apiKeyIndex}`}>
          Trading key active
        </span>
        <button
          type="button"
          disabled={isRevoking}
          onClick={async () => {
            setIsRevoking(true);
            await revokeLighter(venue);
            setIsRevoking(false);
          }}
          className="ml-auto font-semibold text-app-down hover:underline disabled:opacity-60"
        >
          {isRevoking ? "Revoking…" : "Revoke"}
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => openSetup(venue)}
      className="flex items-center gap-2 rounded-lg border border-dashed border-app-hairline-strong px-2.5 py-2 text-left text-[12px] text-app-muted hover:text-app-ink"
    >
      <KeyRound className="size-3.5" aria-hidden />
      No {config.name} trading key yet. Set up trading
    </button>
  );
}

function LighterSection({ venue }: { venue: LighterVenueId }) {
  const { accounts } = useTrading();
  const config = lighterConfigs[venue];
  const account = accounts[venue] ?? null;
  return (
    <Section title={`${config.name} perps`} badge={config.network === "testnet" ? "Testnet" : venue === "lighterRh" ? "Robinhood Chain" : "Mainnet"}>
      <Row label="Account value">{account ? formatPrice(account.accountValue) : "—"}</Row>
      <Row label="Available">{account ? formatPrice(account.withdrawable) : "—"}</Row>
      <FundsButton venue={venue} />
      <LighterTierCard venue={venue} />
      <LighterKeyStatus venue={venue} />
    </Section>
  );
}

/**
 * A Standard account pays no Lighter fee, so none of ours either, and its trades here earn half points. The card says
 * what Plus costs and switches the account (no wallet popup), then asks for the one signature that approves our fee.
 */
function LighterTierCard({ venue }: { venue: LighterVenueId }) {
  const { lighterStates, upgradeLighter } = useTrading();
  const [busy, setBusy] = useState(false);
  const config = lighterConfigs[venue];
  const state = lighterStates[venue];
  const feeBps = (config.integrator?.maxTakerFee ?? 0) / 100;
  if (state?.tier !== "std" || !config.integrator || feeBps <= 0) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-app-accent/40 bg-app-accent/5 px-2.5 py-2 text-[12px] leading-snug text-app-muted">
      <p className="font-semibold text-app-ink">Standard account: half points</p>
      <p>
        {config.name} trades on a Standard account earn half points. On Plus they earn full points. Plus pays {config.name}&apos;s 0.005% fee
        and Angler&apos;s fee (up to {Number(feeBps.toFixed(2))} bps) on each trade; switching back is possible after 24 hours.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await upgradeLighter(venue);
          setBusy(false);
        }}
        className="h-7 self-start rounded-md bg-app-accent px-2.5 text-[12px] font-semibold text-app-on-accent hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Switching…" : "Switch to Plus"}
      </button>
    </div>
  );
}

/** Aster perps: balances, deposits through the funds window (withdrawals on Aster's app) and setup. */
function AsterSection() {
  const { accounts, isVenueReady, openSetup } = useTrading();
  const account = accounts.aster ?? null;
  const ready = isVenueReady("aster");
  return (
    <Section title="Aster perps" badge="Mainnet">
      <Row label="Account value">{account ? formatPrice(account.accountValue) : "—"}</Row>
      <Row label="Available">{account ? formatPrice(account.withdrawable) : "—"}</Row>
      <FundsButton venue="aster" />
      <div className="flex gap-2">
        <a
          href={ASTER_APP_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="Withdrawals happen on Aster's own app"
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-app-hairline-strong text-[12px] font-semibold text-app-ink hover:bg-app-chip"
        >
          Open Aster
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
        {!ready && (
          <button type="button" onClick={() => openSetup("aster")} className="h-8 flex-1 rounded-lg bg-app-accent text-[12px] font-semibold text-app-on-accent">
            Set up trading
          </button>
        )}
      </div>
    </Section>
  );
}

function OrderlySection() {
  const { accounts, isVenueReady, openSetup } = useTrading();
  const account = accounts.orderly ?? null;
  const ready = isVenueReady("orderly");
  return (
    <Section title="Orderly perps" badge={orderlyConfig.network === "mainnet" ? "Mainnet" : "Testnet"}>
      <Row label="Account value">{account ? formatPrice(account.accountValue) : "—"}</Row>
      <Row label="Available">{account ? formatPrice(account.withdrawable) : "—"}</Row>
      <FundsButton venue="orderly" />
      <div className="flex gap-2">
        <a
          href={orderlyConfig.appUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Withdrawals happen on an Orderly app for now"
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-app-hairline-strong text-[12px] font-semibold text-app-ink hover:bg-app-chip"
        >
          Open Orderly
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
        {!ready && (
          <button type="button" onClick={() => openSetup("orderly")} className="h-8 flex-1 rounded-lg bg-app-accent text-[12px] font-semibold text-app-on-accent">
            Set up trading
          </button>
        )}
      </div>
    </Section>
  );
}

function ExtendedSection() {
  const { accounts, isVenueReady, openSetup } = useTrading();
  const { address } = useWallet();
  const toast = useToast();
  const [claiming, setClaiming] = useState(false);
  const account = accounts.extended ?? null;
  const ready = isVenueReady("extended");
  const testnet = extendedConfig.network === "testnet";
  const claim = async () => {
    if (!address) return;
    setClaiming(true);
    try {
      const { claimExtendedTestFunds } = await import("@/lib/venues/extended/faucet");
      await claimExtendedTestFunds(address);
      toast({ tone: "success", title: "Test USDC requested", message: "Extended credits $1,000 within a minute (once an hour)." });
    } catch (error) {
      toast({ tone: "error", title: "Couldn't claim test USDC", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setClaiming(false);
    }
  };
  return (
    <Section title="Extended perps" badge={testnet ? "Testnet" : "Mainnet"}>
      <Row label="Account value">{account ? formatPrice(account.accountValue) : "—"}</Row>
      <Row label="Withdrawable">{account ? formatPrice(account.withdrawable) : "—"}</Row>
      {ready && testnet && (
        <button type="button" disabled={claiming} onClick={() => void claim()} className="h-7 rounded-md border border-app-hairline-strong bg-app-chip text-[12px] font-semibold text-app-ink hover:bg-app-card disabled:opacity-50">
          {claiming ? "Claiming…" : "Get test USDC"}
        </button>
      )}
      <div className="flex gap-2">
        <a
          href={extendedConfig.app}
          target="_blank"
          rel="noopener noreferrer"
          title="Deposits and withdrawals happen on Extended's app for now"
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-app-hairline-strong text-[12px] font-semibold text-app-ink hover:bg-app-chip"
        >
          Deposit on Extended
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
        {!ready && (
          <button type="button" onClick={() => openSetup("extended")} className="h-8 flex-1 rounded-lg bg-app-accent text-[12px] font-semibold text-app-on-accent">
            Set up trading
          </button>
        )}
      </div>
    </Section>
  );
}

function PerpSection({ venue }: { venue: PerpVenueId }) {
  return venue === "hyperliquid" ? (
    <HyperliquidSection />
  ) : venue === "aster" ? (
    <AsterSection />
  ) : venue === "orderly" ? (
    <OrderlySection />
  ) : venue === "extended" ? (
    <ExtendedSection />
  ) : (
    <LighterSection venue={venue} />
  );
}

/**
 * Perp account of the venue the order panel trades on (funds, trading key) and no other: more venues mustn't mean
 * more Deposit buttons. Before the panel has picked one, the preferred perp venue stands in.
 */
function PerpAccount() {
  const { preferences } = usePreferences();
  const { tradeVenue } = useSelectedAsset();
  const enabled: Record<PerpVenueId, boolean> = { hyperliquid: preferences.venueHyperliquid, lighter: preferences.venueLighter, lighterRh: preferences.venueLighterRh, aster: preferences.venueAster, orderly: preferences.venueOrderly, extended: preferences.venueExtended };
  const venue = [tradeVenue, preferences.preferredPerpVenue, ...(Object.keys(enabled) as PerpVenueId[])].find((entry): entry is PerpVenueId => Boolean(entry && enabled[entry]));
  if (!venue) return null;
  return <PerpSection venue={venue} />;
}

function JupiterSection() {
  const { address } = useSolanaWallet();
  const { symbol, mint } = useSelectedAsset();
  const venues = useAssetVenues(symbol, mint, { needSpot: true });
  const token = venues?.spot ?? null;
  const [balances, setBalances] = useState<SpotBalances | null>(null);

  const load = useCallback(async () => {
    if (!address) return setBalances(null);
    try {
      setBalances(await jupiterVenue.getBalances(address, token && token.mint !== USDC_MINT ? [USDC_MINT, token.mint] : [USDC_MINT]));
    } catch {}
  }, [address, token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void load(), BALANCE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <Section title="Jupiter spot" badge="Solana">
      <Row label="USDC">{balances ? fromBaseUnits(balances.tokens[USDC_MINT] ?? 0n, 6).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</Row>
      {token && token.mint !== USDC_MINT && (
        <Row label={token.symbol}>
          {balances ? fromBaseUnits(balances.tokens[token.mint] ?? 0n, token.decimals).toLocaleString("en-US", { maximumSignificantDigits: 6 }) : "—"}
        </Row>
      )}
      <Row label="SOL (fees)">{balances ? fromBaseUnits(balances.lamports, 9).toLocaleString("en-US", { maximumSignificantDigits: 5 }) : "—"}</Row>
    </Section>
  );
}

/** Testnet: links the ETH faucet and mints test USDG in the app (explorers can't call the unverified token's mint). */
function ArcusTestFunds({ address, hasEth, onMinted }: { address: `0x${string}`; hasEth: boolean; onMinted: () => void }) {
  const toast = useToast();
  const { wallet } = useWallet();
  const [isMinting, setIsMinting] = useState(false);
  const mint = async () => {
    if (!wallet) return;
    setIsMinting(true);
    try {
      const { mintTestUsdg } = await import("@/lib/venues/arcus/venue");
      const url = await mintTestUsdg(wallet.provider, address);
      toast({ tone: "success", title: `Minted ${TEST_USDG_MINT_AMOUNT} ${arcusConfig.quoteSymbol}`, link: { href: url, label: "View on explorer" } });
      onMinted();
    } catch (error) {
      toast({ tone: "error", title: "Mint failed", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsMinting(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <a
          href={ROBINHOOD_TESTNET_FAUCET_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-7 items-center justify-center gap-1 rounded-md border border-app-hairline-strong bg-app-chip text-[12px] font-semibold text-app-ink hover:bg-app-card"
        >
          Get test ETH
          <ExternalLink className="size-3" aria-hidden />
        </a>
        <button
          type="button"
          disabled={isMinting || !wallet}
          onClick={() => void mint()}
          className="h-7 rounded-md border border-app-hairline-strong bg-app-chip text-[12px] font-semibold text-app-ink hover:bg-app-card disabled:opacity-50"
        >
          {isMinting ? "Minting…" : `Mint ${TEST_USDG_MINT_AMOUNT} ${arcusConfig.quoteSymbol}`}
        </button>
      </div>
      {!hasEth && <p className="text-[11px] text-app-faint">Get a little test ETH first: minting needs gas.</p>}
    </div>
  );
}

function ArcusSection({ address }: { address: `0x${string}` }) {
  const { symbol } = useSelectedAsset();
  const token = useArcusToken(symbol) ?? null;
  const [state, setState] = useState<{ stable: ArcusToken; amounts: Record<string, bigint>; eth: bigint } | null>(null);

  const load = useCallback(async () => {
    try {
      const [stable, { getArcusBalances, getArcusNativeBalance }] = await Promise.all([arcusQuoteToken(), import("@/lib/venues/arcus/venue")]);
      const [amounts, eth] = await Promise.all([getArcusBalances(address, token ? [stable, token] : [stable]), getArcusNativeBalance(address)]);
      setState({ stable, amounts, eth });
    } catch {}
  }, [address, token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void load(), BALANCE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const show = (amount: bigint | undefined, decimals: number) =>
    amount === undefined ? "—" : fromBaseUnits(amount, decimals).toLocaleString("en-US", { maximumSignificantDigits: 6 });

  return (
    <Section title="Robinhood Chain stock tokens" badge={arcusConfig.network === "testnet" ? "Testnet" : "Mainnet"}>
      <Row label={arcusConfig.quoteSymbol}>{state ? show(state.amounts[state.stable.address], state.stable.decimals) : "—"}</Row>
      {token && <Row label={token.symbol}>{state ? show(state.amounts[token.address], token.decimals) : "—"}</Row>}
      <Row label="ETH (gas)">{state ? show(state.eth, 18) : "—"}</Row>
      {arcusConfig.network === "testnet" && <ArcusTestFunds address={address} hasEth={Boolean(state && state.eth > 0n)} onMinted={load} />}
    </Section>
  );
}

/** True when at least one wallet is connected, so the shell can give the panel a column. */
export function useHasWallet() {
  // Both hooks every render: `a || b` would skip the second one while an EVM wallet is connected.
  const evm = useWallet().address;
  const solana = useSolanaWallet().address;
  return Boolean(evm || solana);
}

/**
 * The trading card: the order panel on top, then balances and trading keys for the venues of the current view
 * (the traded perp venue's account on /perp, Solana and Arcus balances on /swap), only once a wallet is connected; wallets themselves
 * are managed from the Connect button. Each part follows its panel setting. With the order book below it (`grow`
 * off) the card keeps its natural height and scrolls once the book needs the room.
 */
export function AccountPanel({ orderEntry, account, grow = true }: { orderEntry: boolean; account: boolean; grow?: boolean }) {
  const { address: evmAddress } = useWallet();
  const { address: solanaAddress } = useSolanaWallet();
  const { preferences } = usePreferences();
  const kind = terminalKindOf(usePathname()) ?? "perp";
  const { swapVenue } = useSelectedAsset();
  const showAccount = account && Boolean(evmAddress || solanaAddress);
  if (!orderEntry && !showAccount) return null;
  return (
    <div className={`flex min-h-0 flex-col max-lg:shrink-0 ${grow ? "flex-1" : ""}`}>
      <div className={`surface-panel scrollbar-subtle flex min-h-0 flex-col overflow-y-auto rounded-2xl border border-app-card/80 bg-app-card/55 ${grow ? "flex-1" : ""}`}>
        {orderEntry && (
          <div className="border-b border-app-hairline last:border-b-0">
            {kind === "book" ? <SpotOrderPanel /> : <OrderPanel />}
          </div>
        )}
        {showAccount && kind === "perp" && evmAddress && <PerpAccount />}
        {showAccount && kind === "spot" && swapVenue === "solana" && solanaAddress && preferences.venueJupiter && <JupiterSection />}
        {showAccount && kind === "spot" && swapVenue === "arcus" && evmAddress && robinhoodSources(preferences).length > 0 && <ArcusSection address={evmAddress} />}
      </div>
    </div>
  );
}
