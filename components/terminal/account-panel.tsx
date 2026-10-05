"use client";

import { KeyRound, Loader2, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { formatPrice } from "@/lib/format";
import { presetLabel, sideLabel } from "@/lib/trading/presets";
import { fromBaseUnits } from "@/lib/venues/jupiter/amounts";
import { USDC_MINT } from "@/lib/venues/jupiter/config";
import { jupiterVenue } from "@/lib/venues/jupiter/venue";
import type { SpotBalances } from "@/lib/venues/types";
import { useSelectedAsset } from "./selected-asset";
import { useSolanaWallet } from "./solana-wallet-provider";
import { useTradeTicket } from "./trade-ticket";
import { useTrading } from "./trading-provider";
import { useAssetVenues } from "./use-asset-venue";
import { useWallet } from "./wallet-provider";

export const DISCLAIMER = "Not financial advice. Scores are model outputs.";

const BALANCE_REFRESH_MS = 15_000;
const LEVERAGE_CHOICES = [1, 2, 3, 5, 10, 20];

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

const primaryButton =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-app-accent px-3 text-[13px] font-semibold text-app-on-accent transition-colors hover:bg-app-accent/85 disabled:opacity-60";

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
  const { address, connect, isConnecting } = useWallet();
  const { account, network } = useTrading();
  const { preferences, updatePreference } = usePreferences();
  return (
    <Section title="Hyperliquid perps" badge={network === "testnet" ? "Testnet" : "Mainnet"}>
      {!address ? (
        <button type="button" onClick={() => void connect().catch(() => {})} disabled={isConnecting} className={primaryButton}>
          <Wallet className="size-4" aria-hidden />
          {isConnecting ? "Connecting…" : "Connect EVM wallet"}
        </button>
      ) : (
        <>
          <Row label="Account value">{account ? formatPrice(account.accountValue) : "—"}</Row>
          <Row label="Withdrawable">{account ? formatPrice(account.withdrawable) : "—"}</Row>
          <TradingKeyStatus />
        </>
      )}
      <label className="flex items-center justify-between text-[12px]">
        <span className="text-app-muted">Leverage for news trades</span>
        <select
          value={preferences.newsLeverage}
          onChange={(event) => updatePreference("newsLeverage", Number(event.target.value))}
          className="h-7 rounded-md border border-app-hairline-strong bg-app-chip px-1.5 text-[12px] tabular-nums text-app-ink"
        >
          {[...new Set([...LEVERAGE_CHOICES, preferences.newsLeverage])].sort((a, b) => a - b).map((value) => (
            <option key={value} value={value}>
              {value}x
            </option>
          ))}
        </select>
      </label>
    </Section>
  );
}

function JupiterSection() {
  const toast = useToast();
  const { wallets, wallet, address, connect, disconnect } = useSolanaWallet();
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
      {!address ? (
        wallets.length === 0 ? (
          <a href="https://phantom.com/download" target="_blank" rel="noopener noreferrer" className={primaryButton}>
            <Wallet className="size-4" aria-hidden />
            Install a Solana wallet
          </a>
        ) : (
          wallets.map((entry) => (
            <button
              key={entry.name}
              type="button"
              onClick={() =>
                void connect(entry).catch((error: unknown) =>
                  toast({ tone: "error", title: "Couldn't connect", message: error instanceof Error ? error.message : String(error) }),
                )
              }
              className={primaryButton}
            >
              {entry.icon && <img src={entry.icon} alt="" className="size-4 rounded" />}
              Connect {entry.name}
            </button>
          ))
        )
      ) : (
        <>
          <div className="flex items-center gap-2 text-[12px]">
            {wallet?.icon && <img src={wallet.icon} alt="" className="size-4 rounded" />}
            <span className="font-mono text-app-ink">
              {address.slice(0, 4)}…{address.slice(-4)}
            </span>
            <button type="button" onClick={() => void disconnect()} className="ml-auto font-semibold text-app-muted hover:text-app-ink">
              Disconnect
            </button>
          </div>
          <Row label="USDC">{balances ? fromBaseUnits(balances.tokens[USDC_MINT] ?? 0n, 6).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</Row>
          {token && token.mint !== USDC_MINT && (
            <Row label={token.symbol}>
              {balances ? fromBaseUnits(balances.tokens[token.mint] ?? 0n, token.decimals).toLocaleString("en-US", { maximumSignificantDigits: 6 }) : "—"}
            </Row>
          )}
          <Row label="SOL (fees)">{balances ? fromBaseUnits(balances.lamports, 9).toLocaleString("en-US", { maximumSignificantDigits: 5 }) : "—"}</Row>
        </>
      )}
    </Section>
  );
}

function ArmedTicket() {
  const { ticket, pendingKey, confirm, cancel } = useTradeTicket();
  if (pendingKey) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-app-hairline-strong bg-app-chip/60 px-2.5 py-2 text-[12px] text-app-ink">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Placing order… confirm in your wallet if asked.
      </div>
    );
  }
  if (!ticket) {
    return <p className="text-[12px] leading-snug text-app-muted">Trade from important news: pick a size under an asset on a news card.</p>;
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-app-hairline-strong bg-app-chip/60 px-2.5 py-2 text-[12px]">
      <p className="font-semibold text-app-ink">
        {sideLabel(ticket.venue, ticket.side)} {ticket.symbol} · ${presetLabel(ticket.sizeUsd)} on {ticket.venue === "perp" ? "Hyperliquid" : "Jupiter"}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={confirm}
          className={`h-8 flex-1 rounded-md text-[12px] font-semibold text-white ${ticket.side === "buy" ? "bg-app-up" : "bg-app-down"}`}
        >
          Confirm
        </button>
        <button type="button" onClick={cancel} className="h-8 rounded-md border border-app-hairline-strong px-3 text-[12px] font-semibold text-app-muted hover:text-app-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Wallets, trading setup and balances. Orders are placed from news cards, not from a form. */
export function AccountPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="surface-panel scrollbar-subtle flex min-h-0 flex-1 flex-col overflow-y-auto rounded-2xl border border-app-card/80 bg-app-card/55">
        <Section title="Order">
          <ArmedTicket />
        </Section>
        <HyperliquidSection />
        <JupiterSection />
      </div>
      <p className="shrink-0 px-1 text-center text-[10px] leading-tight text-app-faint">{DISCLAIMER}</p>
    </div>
  );
}
