"use client";

import { ExternalLink, KeyRound } from "lucide-react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useCallback, useEffect, useState } from "react";
import { formatPrice } from "@/lib/format";
import { fromBaseUnits } from "@/lib/venues/jupiter/amounts";
import { arcusConfig } from "@/lib/venues/arcus/config";
import type { ArcusToken } from "@/lib/venues/arcus/tokens";
import { arcusQuoteToken } from "@/lib/venues/arcus/catalog";
import { lighterConfig } from "@/lib/venues/lighter/config";
import { USDC_MINT } from "@/lib/venues/jupiter/config";
import { jupiterVenue } from "@/lib/venues/jupiter/venue";
import { OrderPanel } from "./order-panel";
import type { SpotBalances } from "@/lib/venues/types";
import { useSelectedAsset } from "./selected-asset";
import { useSolanaWallet } from "./solana-wallet-provider";
import { useTrading } from "./trading-provider";
import { useArcusToken } from "./use-arcus-token";
import { useAssetVenues } from "./use-asset-venue";
import { useWallet } from "./wallet-provider";

const BALANCE_REFRESH_MS = 15_000;

function Section({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-app-hairline p-3 last:border-b-0">
      <header className="flex items-center gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-app-muted">{title}</h3>
        {badge && <span className="ml-auto rounded bg-app-chip px-1.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em] text-app-muted">{badge}</span>}
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

function FundsButton({ venue }: { venue: "hyperliquid" | "lighter" }) {
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

function LighterKeyStatus() {
  const { lighter, revokeLighter, openSetup } = useTrading();
  const [isRevoking, setIsRevoking] = useState(false);
  if (!lighter) return <p className="text-[12px] text-app-faint">Checking Lighter account…</p>;
  if (lighter.accountIndex === null) {
    return (
      <a
        href={lighterConfig.appUrl}
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
        <span className="font-medium text-app-ink" title={`Account ${lighter.accountIndex}, key index ${lighterConfig.apiKeyIndex}`}>
          Trading key active
        </span>
        <button
          type="button"
          disabled={isRevoking}
          onClick={async () => {
            setIsRevoking(true);
            await revokeLighter();
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
      onClick={() => openSetup("lighter")}
      className="flex items-center gap-2 rounded-lg border border-dashed border-app-hairline-strong px-2.5 py-2 text-left text-[12px] text-app-muted hover:text-app-ink"
    >
      <KeyRound className="size-3.5" aria-hidden />
      No Lighter trading key yet. Set up trading
    </button>
  );
}

function LighterSection() {
  const { accounts, lighterNetwork } = useTrading();
  const account = accounts.lighter ?? null;
  return (
    <Section title="Lighter perps" badge={lighterNetwork === "testnet" ? "Testnet" : "Mainnet"}>
      <Row label="Account value">{account ? formatPrice(account.accountValue) : "—"}</Row>
      <Row label="Available">{account ? formatPrice(account.withdrawable) : "—"}</Row>
      <FundsButton venue="lighter" />
      <LighterKeyStatus />
    </Section>
  );
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
    <Section title="Arcus stock tokens" badge={arcusConfig.network === "testnet" ? "Testnet" : "Mainnet"}>
      <Row label={arcusConfig.quoteSymbol}>{state ? show(state.amounts[state.stable.address], state.stable.decimals) : "—"}</Row>
      {token && <Row label={token.symbol}>{state ? show(state.amounts[token.address], token.decimals) : "—"}</Row>}
      <Row label="ETH (approvals)">{state ? show(state.eth, 18) : "—"}</Row>
    </Section>
  );
}

/** True when at least one wallet is connected, so the shell can give the panel a column. */
export function useHasWallet() {
  return Boolean(useWallet().address || useSolanaWallet().address);
}

/**
 * The trading card: the order panel on top, then balances and trading keys per venue (only once a wallet is
 * connected; wallets themselves are managed from the Connect button). Each part follows its panel setting. With the
 * order book below it (`grow` off) the card keeps its natural height and scrolls once the book needs the room.
 */
export function AccountPanel({ orderEntry, account, grow = true }: { orderEntry: boolean; account: boolean; grow?: boolean }) {
  const { address: evmAddress } = useWallet();
  const { address: solanaAddress } = useSolanaWallet();
  const { preferences } = usePreferences();
  const showAccount = account && Boolean(evmAddress || solanaAddress);
  if (!orderEntry && !showAccount) return null;
  return (
    <div className={`flex min-h-0 flex-col max-lg:shrink-0 ${grow ? "flex-1" : ""}`}>
      <div className={`surface-panel scrollbar-subtle flex min-h-0 flex-col overflow-y-auto rounded-2xl border border-app-card/80 bg-app-card/55 ${grow ? "flex-1" : ""}`}>
        {orderEntry && (
          <div className="border-b border-app-hairline last:border-b-0">
            <OrderPanel />
          </div>
        )}
        {showAccount && evmAddress && <HyperliquidSection />}
        {showAccount && evmAddress && preferences.venueLighter && <LighterSection />}
        {showAccount && solanaAddress && <JupiterSection />}
        {showAccount && evmAddress && preferences.venueArcus && <ArcusSection address={evmAddress} />}
      </div>
    </div>
  );
}
