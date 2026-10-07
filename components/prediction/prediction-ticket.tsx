"use client";

import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { useTrading } from "@/components/terminal/trading-provider";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { useWallet } from "@/components/terminal/wallet-provider";
import { trackTrade } from "@/lib/analytics/client";
import { HIP4_MIN_ORDER_USD } from "@/lib/prediction/hip4";
import { contractsFor, outcomeOrderError } from "@/lib/prediction/hip4-trade";
import { walkAsks, type PredictionBook } from "@/lib/prediction/market-data";
import { formatChance, type PredictionEvent, type PredictionMarket } from "@/lib/prediction/types";
import type { OutcomeAccount } from "@/lib/venues/hyperliquid/outcomes";

const PRESETS = [10, 25, 50, 100];
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const cents = (price: number | null) => (price === null ? "—" : `${(price * 100).toFixed(price < 0.1 || price > 0.9 ? 1 : 0)}¢`);

/** The connected wallet's HIP-4 balances (spot USDC and `+N` holdings), refreshed after each trade. */
function useOutcomeAccount(enabled: boolean) {
  const { address } = useWallet();
  const [account, setAccount] = useState<OutcomeAccount | null>(null);
  const refresh = useCallback(async () => {
    if (!address || !enabled) return setAccount(null);
    try {
      const { loadOutcomeAccount } = await import("@/lib/venues/hyperliquid/outcomes");
      setAccount(await loadOutcomeAccount(address));
    } catch {
      setAccount(null);
    }
  }, [address, enabled]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return { account, refresh };
}

/**
 * Buy panel for the selected market and side: a dollar amount, what it buys from the book (contracts, average price,
 * payout if right), then a two-press trade. HIP-4 trades with the Hyperliquid account; Polymarket opens next.
 */
export function PredictionTicket({
  event,
  market,
  side,
  onSide,
  book,
}: {
  event: PredictionEvent;
  market: PredictionMarket;
  side: 0 | 1;
  onSide: (side: 0 | 1) => void;
  book: PredictionBook | null;
}) {
  const toast = useToast();
  const wallets = useWalletModal();
  const { address, getWalletClient } = useWallet();
  const { isReady, openSetup } = useTrading();
  const { preferences } = usePreferences();
  const isHip4 = event.source === "hyperliquid";
  const { account, refresh } = useOutcomeAccount(isHip4);
  const [amount, setAmount] = useState("25");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const outcome = market.outcomes[side];
  const holding = account?.holdings.find((entry) => entry.coin === outcome.asset) ?? null;

  useEffect(() => setArmed(false), [market.id, side, amount]);

  const spend = Number(amount);
  const fill = useMemo(() => (book && spend > 0 ? walkAsks(book.asks, spend) : null), [book, spend]);
  const bestAsk = book?.asks[0]?.price ?? null;
  const bestBid = book?.bids[0]?.price ?? null;
  const contracts = isHip4 && bestAsk ? contractsFor(spend, bestAsk) : (fill?.shares ?? 0);
  const problem = !(spend > 0)
    ? "Enter an amount."
    : !market.acceptingOrders
      ? "This market isn't taking orders."
      : !bestAsk
        ? "Nobody is selling this side right now."
        : isHip4
          ? outcomeOrderError(contracts, bestAsk)
          : !fill
            ? "The book is too thin for this amount."
            : null;
  const needsSpot = isHip4 && account !== null && !account.unified && account.spotUsdc < spend;

  const buyHip4 = async () => {
    if (!address) return wallets.open();
    if (!isReady) return openSetup("hyperliquid");
    if (!armed && !preferences.oneClickTrading) return setArmed(true);
    setBusy(true);
    try {
      const { placeOutcomeOrder } = await import("@/lib/venues/hyperliquid/outcomes");
      const result = await placeOutcomeOrder(address, { side: "buy", coin: outcome.asset, usd: spend, reference: bestAsk! });
      toast({
        tone: "success",
        title: `Bought ${result.contracts} ${outcome.label} at ${cents(result.avgPx)}`,
        message: `${market.label === event.title ? event.title : `${event.title} · ${market.label}`} · pays ${usd.format(result.contracts)} if right`,
      });
      trackTrade({ venue: "hyperliquid", side: "buy", newsId: null, oneClick: preferences.oneClickTrading, usd: result.contracts * result.avgPx, feeBps: null });
      void refresh();
    } catch (error) {
      toast({ tone: "error", title: "Order failed", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  const sellHip4 = async () => {
    if (!address || !holding || !bestBid) return;
    setBusy(true);
    try {
      const { placeOutcomeOrder } = await import("@/lib/venues/hyperliquid/outcomes");
      const result = await placeOutcomeOrder(address, { side: "sell", coin: outcome.asset, contracts: holding.contracts, reference: bestBid });
      toast({ tone: "success", title: `Sold ${result.contracts} ${outcome.label} at ${cents(result.avgPx)}`, message: usd.format(result.contracts * result.avgPx) });
      trackTrade({ venue: "hyperliquid", side: "sell", newsId: null, oneClick: false, usd: result.contracts * result.avgPx, feeBps: null });
      void refresh();
    } catch (error) {
      toast({ tone: "error", title: "Sell failed", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const moveToSpot = async () => {
    if (!getWalletClient || !account) return;
    setBusy(true);
    try {
      const { moveUsdcToSpot } = await import("@/lib/venues/hyperliquid/outcomes");
      await moveUsdcToSpot(await getWalletClient(), spend - account.spotUsdc);
      toast({ tone: "success", title: "USDC moved to spot", message: "You can buy outcomes now." });
      void refresh();
    } catch (error) {
      toast({ tone: "error", title: "Couldn't move USDC", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const sideButton = (index: 0 | 1) => {
    const active = side === index;
    return (
      <button
        type="button"
        onClick={() => onSide(index)}
        aria-pressed={active}
        className={`flex h-11 flex-1 items-center justify-between rounded-xl border px-3 text-[13px] font-semibold transition-colors ${
          active ? (index === 0 ? "border-app-up/60 bg-app-up/15 text-app-up" : "border-app-down/60 bg-app-down/15 text-app-down") : "border-app-hairline-strong text-app-muted hover:text-app-ink"
        }`}
      >
        <span className="truncate">{market.outcomes[index].label}</span>
        <span className="tabular-nums">{cents(market.outcomes[index].price)}</span>
      </button>
    );
  };

  const label = !address
    ? "Connect wallet"
    : isHip4 && !isReady
      ? "Set up Hyperliquid trading"
      : armed
        ? `Confirm: buy ${outcome.label} for ${usd.format(spend)}`
        : `Buy ${outcome.label}`;

  return (
    <section aria-label="Trade" className="flex flex-col gap-3 p-4">
      <div>
        <p className="truncate text-[12px] text-app-muted">{market.label === event.title ? "Outcome" : market.label}</p>
        <div className="mt-2 flex gap-2">
          {sideButton(0)}
          {sideButton(1)}
        </div>
      </div>

      <label className="flex h-11 items-center gap-2 rounded-xl border border-app-field-border bg-app-field px-3 focus-within:border-app-focus">
        <span className="text-[13px] text-app-muted">Amount</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(change) => setAmount(change.target.value.replace(/[^\d.]/g, ""))}
          aria-label="Amount in USD"
          className="min-w-0 flex-1 bg-transparent text-right text-[15px] font-semibold tabular-nums text-app-ink outline-hidden"
        />
        <span className="text-[13px] text-app-muted">USD</span>
      </label>
      <div className="grid grid-cols-4 gap-1.5">
        {PRESETS.map((preset) => (
          <button key={preset} type="button" onClick={() => setAmount(String(preset))} className="h-8 rounded-lg bg-app-chip text-[12px] font-semibold text-app-ink hover:bg-app-selected">
            ${preset}
          </button>
        ))}
      </div>

      <dl className="space-y-1.5 text-[12px]">
        <div className="flex justify-between">
          <dt className="text-app-muted">Chance</dt>
          <dd className="tabular-nums text-app-ink">{formatChance(outcome.price)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-app-muted">Avg. price</dt>
          <dd className="tabular-nums text-app-ink">{isHip4 ? cents(bestAsk) : cents(fill?.average ?? null)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-app-muted">{isHip4 ? "Contracts" : "Shares"}</dt>
          <dd className="tabular-nums text-app-ink">{contracts > 0 ? contracts.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-app-muted">Pays if right</dt>
          <dd className="font-semibold tabular-nums text-app-up">{contracts > 0 ? usd.format(contracts) : "—"}</dd>
        </div>
        {isHip4 && account && (
          <div className="flex justify-between">
            <dt className="text-app-muted">{account.unified ? "Available" : "Spot USDC"}</dt>
            <dd className="tabular-nums text-app-ink">{usd.format(account.unified ? account.spendable : account.spotUsdc)}</dd>
          </div>
        )}
      </dl>

      {isHip4 ? (
        <>
          {needsSpot && (
            <button type="button" disabled={busy} onClick={moveToSpot} className="h-9 rounded-xl border border-app-hairline-strong text-[12px] font-semibold text-app-ink hover:bg-app-selected/70 disabled:opacity-60">
              Move {usd.format(Math.max(0, spend - (account?.spotUsdc ?? 0)))} from perps to spot
            </button>
          )}
          <button
            type="button"
            disabled={busy || (Boolean(address) && isReady && problem !== null)}
            onClick={buyHip4}
            className={`h-11 rounded-xl text-[14px] font-semibold transition-colors disabled:opacity-50 ${
              side === 0 ? "bg-app-up text-white hover:bg-app-up/90" : "bg-app-down text-white hover:bg-app-down/90"
            }`}
          >
            {busy ? "Sending…" : label}
          </button>
          {address && isReady && problem && <p className="text-[11px] text-app-muted">{problem}</p>}
          {holding && (
            <div className="flex items-center justify-between rounded-xl bg-app-chip/60 px-3 py-2 text-[12px]">
              <span className="text-app-muted">
                You hold <span className="font-semibold text-app-ink">{holding.contracts}</span> {outcome.label}
              </span>
              <button type="button" disabled={busy || !bestBid} onClick={sellHip4} className="font-semibold text-app-down hover:underline disabled:opacity-50">
                Sell at {cents(bestBid)}
              </button>
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-app-faint">
            Hyperliquid outcome market: uses your Hyperliquid account, minimum ${HIP4_MIN_ORDER_USD} per order. Each contract pays $1 if its side wins.
          </p>
        </>
      ) : (
        <>
          <button type="button" disabled className="h-11 rounded-xl bg-app-chip text-[14px] font-semibold text-app-muted">
            Polymarket trading is coming next
          </button>
          {event.url && (
            <a href={event.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 text-[12px] text-app-muted hover:text-app-ink">
              View on Polymarket <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </>
      )}
    </section>
  );
}
