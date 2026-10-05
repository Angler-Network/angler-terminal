"use client";

import { KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatPrice } from "@/lib/format";
import { fromBaseUnits } from "@/lib/venues/jupiter/amounts";
import { USDC_MINT } from "@/lib/venues/jupiter/config";
import { jupiterVenue } from "@/lib/venues/jupiter/venue";
import type { SpotBalances } from "@/lib/venues/types";
import { useSelectedAsset } from "./selected-asset";
import { useSolanaWallet } from "./solana-wallet-provider";
import { useTrading } from "./trading-provider";
import { useAssetVenues } from "./use-asset-venue";
import { useWallet } from "./wallet-provider";

export const DISCLAIMER = "Not financial advice. Scores are model outputs.";

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
      onClick={openSetup}
      className="flex items-center gap-2 rounded-lg border border-dashed border-app-hairline-strong px-2.5 py-2 text-left text-[12px] text-app-muted hover:text-app-ink"
    >
      <KeyRound className="size-3.5" aria-hidden />
      No trading key yet. Set up trading
    </button>
  );
}

function HyperliquidSection() {
  const { account, network } = useTrading();
  return (
    <Section title="Hyperliquid perps" badge={network === "testnet" ? "Testnet" : "Mainnet"}>
      <Row label="Account value">{account ? formatPrice(account.accountValue) : "—"}</Row>
      <Row label="Withdrawable">{account ? formatPrice(account.withdrawable) : "—"}</Row>
      <TradingKeyStatus />
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

/** True when at least one wallet is connected, so the shell can give the panel a column. */
export function useHasWallet() {
  return Boolean(useWallet().address || useSolanaWallet().address);
}

/**
 * Balances and the Hyperliquid trading key for the connected wallets. Hidden until a wallet is connected; wallets
 * themselves are managed from the Connect button. Orders are placed from news cards.
 */
export function AccountPanel() {
  const { address: evmAddress } = useWallet();
  const { address: solanaAddress } = useSolanaWallet();
  if (!evmAddress && !solanaAddress) return null;
  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="surface-panel scrollbar-subtle flex min-h-0 flex-1 flex-col overflow-y-auto rounded-2xl border border-app-card/80 bg-app-card/55">
        {evmAddress && <HyperliquidSection />}
        {solanaAddress && <JupiterSection />}
      </div>
      <p className="shrink-0 px-1 text-center text-[10px] leading-tight text-app-faint">{DISCLAIMER}</p>
    </div>
  );
}
