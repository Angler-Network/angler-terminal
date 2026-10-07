"use client";

import { Copy, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { useWallet } from "@/components/terminal/wallet-provider";
import { trackTrade } from "@/lib/analytics/client";
import type { PredictionBook } from "@/lib/prediction/market-data";
import type { PredictionEvent, PredictionOutcome } from "@/lib/prediction/types";
import { ARBITRUM, BASE, USDC_DECIMALS, type SourceChain } from "@/lib/venues/deposits";
import type { Geoblock, PolymarketAccount } from "@/lib/venues/polymarket/client";
import { polymarketBuilderCode } from "@/lib/venues/polymarket/config";
import type { SecureClient } from "@polymarket/client";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const cents = (price: number) => `${(price * 100).toFixed(price < 0.1 || price > 0.9 ? 1 : 0)}¢`;
/** How far past the best price a market order may fill (5¢ on a $1 share). */
const SLIPPAGE = 0.05;
/** Polymarket's bridge minimum from Arbitrum and Base. */
const MIN_BRIDGE_USD = 2;

const client = () => import("@/lib/venues/polymarket/client");

/**
 * Polymarket's part of the order panel. Orders go from this browser to Polymarket, so its geoblock check runs here
 * first; a blocked or unreachable network can't trade. The account is a Deposit Wallet the SDK creates gaslessly;
 * it trades pUSD, funded through Polymarket's bridge (USDC from Arbitrum or Base).
 */
export function PolymarketTrade({
  event,
  outcome,
  spend,
  problem,
  book,
  tone,
}: {
  event: PredictionEvent;
  outcome: PredictionOutcome;
  spend: number;
  problem: string | null;
  book: PredictionBook | null;
  /** Yes buys are green, No buys red, like the side buttons. */
  tone: "up" | "down";
}) {
  const toast = useToast();
  const wallets = useWalletModal();
  const { address, wallet } = useWallet();
  const { preferences } = usePreferences();
  const [geoblock, setGeoblock] = useState<Geoblock | null>(null);
  const [session, setSession] = useState<SecureClient | null>(null);
  const [account, setAccount] = useState<PolymarketAccount | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [deposit, setDeposit] = useState<{ address: `0x${string}`; source: SourceChain } | null>(null);

  useEffect(() => {
    let live = true;
    void client()
      .then(({ checkGeoblock }) => checkGeoblock())
      .then((result) => live && setGeoblock(result));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    setSession(null);
    setAccount(null);
    setDeposit(null);
  }, [address]);
  useEffect(() => setArmed(false), [outcome.asset, spend]);

  const refresh = useCallback(async (current: SecureClient) => {
    const { loadPolymarketAccount } = await client();
    setAccount(await loadPolymarketAccount(current));
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => void refresh(session).catch(() => {}), 20_000);
    return () => window.clearInterval(timer);
  }, [session, refresh]);

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    try {
      await task();
    } catch (error) {
      toast({ tone: "error", title: "Polymarket", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const connect = () =>
    run("Sign in your wallet…", async () => {
      if (!wallet || !address) return;
      const { polymarketSession } = await client();
      const next = await polymarketSession(wallet.provider, address);
      setSession(next);
      await refresh(next);
    });

  const approve = () =>
    run("Enabling…", async () => {
      if (!session) return;
      const { approvePolymarketTrading } = await client();
      await approvePolymarketTrading(session);
      await refresh(session);
      toast({ tone: "success", title: "Polymarket trading enabled" });
    });

  const openDeposit = (source: SourceChain) =>
    run("Getting deposit address…", async () => {
      if (!account) return;
      const { polymarketDepositAddress } = await client();
      setDeposit({ address: await polymarketDepositAddress(account.wallet), source });
    });

  const sendDeposit = () =>
    run("Confirm in your wallet…", async () => {
      if (!deposit || !wallet || !address || !account) return;
      const amount = Math.max(MIN_BRIDGE_USD, Math.ceil((spend - account.balance) * 100) / 100);
      const { sendUsdc } = await import("@/lib/venues/deposit-client");
      const sent = await sendUsdc(wallet.provider, address, deposit.source, deposit.address, BigInt(Math.round(amount * 10 ** USDC_DECIMALS)));
      toast({ tone: "success", title: `Sent ${usd.format(amount)} USDC to Polymarket`, message: "It's converted to pUSD and credited in a few minutes.", link: { href: sent.explorerUrl, label: "View transaction" } });
      setDeposit(null);
    });

  const bestAsk = book?.asks[0]?.price ?? null;
  const bestBid = book?.bids[0]?.price ?? null;
  const holding = account?.holdings.find((entry) => entry.assetId === outcome.asset) ?? null;

  const buy = () => {
    if (!armed && !preferences.oneClickTrading) return setArmed(true);
    return run("Confirm in your wallet…", async () => {
      if (!session || !bestAsk) return;
      const { buyPolymarket } = await client();
      const result = await buyPolymarket(session, { assetId: outcome.asset, usd: spend, maxPrice: bestAsk + SLIPPAGE });
      setArmed(false);
      if (!result.ok) throw new Error(result.message ?? "Order rejected.");
      toast({ tone: "success", title: `Bought ${outcome.label} for ${usd.format(spend)}`, message: `${event.title} · ${result.status}` });
      trackTrade({ venue: "polymarket", side: "buy", newsId: null, oneClick: preferences.oneClickTrading, usd: spend, feeBps: null });
      await refresh(session);
    });
  };

  const sell = () =>
    run("Confirm in your wallet…", async () => {
      if (!session || !holding || !bestBid) return;
      const { sellPolymarket } = await client();
      const result = await sellPolymarket(session, { assetId: outcome.asset, shares: holding.shares, minPrice: bestBid - SLIPPAGE });
      if (!result.ok) throw new Error(result.message ?? "Order rejected.");
      toast({ tone: "success", title: `Sold ${outcome.label}`, message: `${holding.shares.toFixed(2)} shares near ${cents(bestBid)}` });
      trackTrade({ venue: "polymarket", side: "sell", newsId: null, oneClick: false, usd: holding.shares * bestBid, feeBps: null });
      await refresh(session);
    });

  const note = (text: string) => <p className="rounded-xl bg-app-chip/60 px-3 py-2.5 text-[12px] leading-relaxed text-app-muted">{text}</p>;
  const primary = "h-11 rounded-xl text-[14px] font-semibold transition-colors disabled:opacity-50";
  const link = event.url && (
    <a href={event.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 text-[12px] text-app-muted hover:text-app-ink">
      View on Polymarket <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );

  let body: React.ReactNode;
  if (!polymarketBuilderCode) body = note("Polymarket trading isn't switched on for this site yet. Odds, charts and books are live.");
  else if (!address) body = <button type="button" onClick={wallets.open} className={`${primary} bg-app-accent text-app-on-accent`}>Connect wallet</button>;
  else if (!geoblock) body = note("Checking Polymarket from your network…");
  else if (!geoblock.reachable) body = note("Polymarket isn't reachable from your network, so orders can't be placed from here. Prices and charts still update.");
  else if (geoblock.blocked) body = note(`Polymarket doesn't allow trading from your location${geoblock.country ? ` (${geoblock.country})` : ""}.`);
  else if (!session || !account)
    body = (
      <>
        <button type="button" disabled={busy !== null} onClick={connect} className={`${primary} bg-app-accent text-app-on-accent`}>
          {busy ?? "Connect Polymarket account"}
        </button>
        <p className="text-[11px] leading-relaxed text-app-faint">Your wallet signs once to sign in. Your Polymarket account (a smart wallet you control) is created for free if you don&apos;t have one.</p>
      </>
    );
  else if (!account.approved)
    body = (
      <button type="button" disabled={busy !== null} onClick={approve} className={`${primary} bg-app-accent text-app-on-accent`}>
        {busy ?? "Enable trading (free)"}
      </button>
    );
  else if (account.balance < spend)
    body = deposit ? (
      <div className="space-y-2 rounded-xl bg-app-chip/60 p-3 text-[12px]">
        <p className="text-app-muted">
          Send USDC on {deposit.source.name} to your Polymarket deposit address. It&apos;s converted to pUSD (minimum ${MIN_BRIDGE_USD}).
        </p>
        <button type="button" onClick={() => void navigator.clipboard.writeText(deposit.address)} className="flex w-full items-center gap-2 rounded-lg bg-app-card px-2 py-1.5 text-left font-mono text-[11px] text-app-ink">
          <span className="min-w-0 flex-1 truncate">{deposit.address}</span>
          <Copy className="size-3.5 shrink-0 text-app-muted" aria-hidden />
        </button>
        <button type="button" disabled={busy !== null} onClick={sendDeposit} className="h-9 w-full rounded-lg bg-app-accent text-[12px] font-semibold text-app-on-accent disabled:opacity-50">
          {busy ?? `Send ${usd.format(Math.max(MIN_BRIDGE_USD, spend - account.balance))} USDC from ${deposit.source.name}`}
        </button>
      </div>
    ) : (
      <>
        {note(`Your Polymarket balance is ${usd.format(account.balance)}. Add pUSD to buy.`)}
        <div className="flex gap-2">
          {[ARBITRUM, BASE].map((source) => (
            <button key={source.chainId} type="button" disabled={busy !== null} onClick={() => openDeposit(source)} className="h-9 flex-1 rounded-xl border border-app-hairline-strong text-[12px] font-semibold text-app-ink hover:bg-app-selected/70 disabled:opacity-50">
              Deposit from {source.name}
            </button>
          ))}
        </div>
      </>
    );
  else
    body = (
      <>
        <button
          type="button"
          disabled={busy !== null || problem !== null}
          onClick={buy}
          className={`${primary} ${tone === "up" ? "bg-app-up text-white hover:bg-app-up/90" : "bg-app-down text-white hover:bg-app-down/90"}`}
        >
          {busy ?? (armed ? `Confirm: buy ${outcome.label} for ${usd.format(spend)}` : `Buy ${outcome.label}`)}
        </button>
        {problem && <p className="text-[11px] text-app-muted">{problem}</p>}
      </>
    );

  return (
    <>
      {account && (
        <p className="flex justify-between text-[12px]">
          <span className="text-app-muted">Polymarket balance</span>
          <span className="tabular-nums text-app-ink">{usd.format(account.balance)}</span>
        </p>
      )}
      {body}
      {holding && (
        <div className="flex items-center justify-between rounded-xl bg-app-chip/60 px-3 py-2 text-[12px]">
          <span className="text-app-muted">
            You hold <span className="font-semibold text-app-ink">{holding.shares.toFixed(2)}</span> {outcome.label}
          </span>
          <button type="button" disabled={busy !== null || !bestBid} onClick={sell} className="font-semibold text-app-down hover:underline disabled:opacity-50">
            Sell{bestBid ? ` at ${cents(bestBid)}` : ""}
          </button>
        </div>
      )}
      {link}
    </>
  );
}
