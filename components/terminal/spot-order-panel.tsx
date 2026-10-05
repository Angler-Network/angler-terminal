"use client";

import { Copy, ExternalLink, Loader2, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { useToast } from "@/components/app/toast-provider";
import { formatPrice } from "@/lib/format";
import { fromBaseUnits, usdToInputAmount } from "@/lib/venues/jupiter/amounts";
import { spendableBalance } from "@/lib/venues/jupiter/balances";
import { trackTrade } from "@/lib/analytics/client";
import { sizePresets } from "@/lib/trading/presets";
import { SOLSCAN_TOKEN_URL, WSOL_MINT } from "@/lib/venues/jupiter/config";
import { MESSAGES } from "@/lib/venues/jupiter/errors";
import { SwapFailedError, jupiterVenue } from "@/lib/venues/jupiter/venue";
import type { OrderSide, SpotBalances, SpotQuote, SpotSwapResult, SpotToken } from "@/lib/venues/types";
import { useSelectedAsset } from "./selected-asset";
import { useSolanaWallet } from "./solana-wallet-provider";
import { TicketBanner } from "./ticket-banner";
import { useTradeTicket, type TradeTicket } from "./trade-ticket";
import { useTicketBinding, type PanelStatus } from "./use-ticket-binding";

const QUOTE_REFRESH_MS = 5_000;
const BALANCE_REFRESH_MS = 15_000;
/** Lamports to keep for fees on top of what the quote reports (ATA rent, retries). */
const SOL_FEE_BUFFER = 2_000_000n;

const presets = sizePresets.spot;

const field =
  "h-9 w-full rounded-lg border border-app-hairline-strong bg-app-chip px-3 text-[13px] tabular-nums text-app-ink placeholder:text-app-faint focus:border-app-focus focus:outline-none";

function amountText(amount: bigint, token: SpotToken) {
  const value = fromBaseUnits(amount, token.decimals);
  return `${value.toLocaleString("en-US", { maximumSignificantDigits: 6 })} ${token.symbol}`;
}

function shortMint(mint: string) {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function Row({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "warn" }) {
  return (
    <>
      <dt className="text-app-muted">{label}</dt>
      <dd className={`text-right tabular-nums ${tone === "warn" ? "text-app-down" : "text-app-ink"}`}>{children}</dd>
    </>
  );
}

function SolanaConnect() {
  const { wallets, connect } = useSolanaWallet();
  const toast = useToast();
  if (wallets.length === 0) {
    return (
      <a
        href="https://phantom.com/download"
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-10 items-center justify-center gap-2 rounded-xl bg-app-accent text-[14px] font-semibold text-app-on-accent"
      >
        <Wallet className="size-4" aria-hidden />
        Install a Solana wallet
      </a>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {wallets.map((wallet) => (
        <button
          key={wallet.name}
          type="button"
          onClick={() =>
            void connect(wallet).catch((error: unknown) =>
              toast({ tone: "error", title: "Couldn't connect", message: error instanceof Error ? error.message : String(error) }),
            )
          }
          className="flex h-10 items-center justify-center gap-2 rounded-xl bg-app-accent text-[14px] font-semibold text-app-on-accent hover:bg-app-accent/85"
        >
          {wallet.icon && <img src={wallet.icon} alt="" className="size-5 rounded" />}
          Connect {wallet.name}
        </button>
      ))}
    </div>
  );
}

export function SpotOrderPanel({ token, venueTabs }: { token: SpotToken; venueTabs?: React.ReactNode }) {
  const toast = useToast();
  const { address, signTransaction, disconnect, wallet } = useSolanaWallet();
  const [usdc, setUsdc] = useState<SpotToken | null>(null);
  const [side, setSide] = useState<OrderSide>("buy");
  const [usd, setUsd] = useState(String(presets[0]));
  const [quote, setQuote] = useState<SpotQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [balances, setBalances] = useState<SpotBalances | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const [lastResult, setLastResult] = useState<SpotSwapResult | null>(null);
  const isSwappingRef = useRef(false);

  useEffect(() => {
    jupiterVenue.quoteToken().then(setUsdc).catch(() => setQuoteError("USDC isn't available on Jupiter right now."));
  }, []);

  const inputToken = side === "buy" ? usdc : token;
  const outputToken = side === "buy" ? token : usdc;

  const amount = useMemo(() => {
    if (!usdc) return 0n;
    try {
      return usdToInputAmount(Number(usd), side, usdc, token);
    } catch {
      return 0n;
    }
  }, [usd, side, usdc, token]);

  const loadBalances = useCallback(async () => {
    if (!address || !usdc) return setBalances(null);
    try {
      setBalances(await jupiterVenue.getBalances(address, [usdc.mint, token.mint]));
    } catch {}
  }, [address, usdc, token.mint]);

  useEffect(() => {
    void loadBalances();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void loadBalances(), BALANCE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadBalances]);

  const fetchQuote = useCallback(async () => {
    if (!inputToken || !outputToken || amount <= 0n) return null;
    return jupiterVenue.getQuote({ inputToken, outputToken, amount, taker: address ?? undefined });
  }, [inputToken, outputToken, amount, address]);

  // Keep the quote fresh while the panel is open; pause while hidden or mid-swap.
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (amount <= 0n) return;
    let isActive = true;
    const load = async () => {
      if (document.visibilityState === "hidden" || isSwappingRef.current) return;
      try {
        const next = await fetchQuote();
        if (isActive && !isSwappingRef.current) {
          setQuote(next);
          setQuoteError(null);
        }
      } catch (error) {
        if (isActive) setQuoteError(error instanceof Error ? error.message : "Couldn't get a quote.");
      }
    };
    const debounce = window.setTimeout(load, 300);
    const timer = window.setInterval(load, QUOTE_REFRESH_MS);
    return () => {
      isActive = false;
      window.clearTimeout(debounce);
      window.clearInterval(timer);
    };
  }, [fetchQuote, amount]);

  const inputBalance = balances && inputToken ? spendableBalance(inputToken.mint, balances.tokens, balances.lamports) : null;
  const tokenBalance = balances ? spendableBalance(token.mint, balances.tokens, balances.lamports) : null;
  const usdcBalance = balances && usdc ? balances.tokens[usdc.mint] ?? 0n : null;
  const feeLamports = BigInt(quote?.networkFeeLamports ?? 0) + SOL_FEE_BUFFER;
  const spendsSol = inputToken?.mint === WSOL_MINT;
  const lacksBalance = inputBalance !== null && amount > 0n && amount + (spendsSol ? feeLamports : 0n) > inputBalance;
  const lacksSol = balances !== null && !spendsSol && balances.lamports < feeLamports;

  const blocker = !address
    ? null
    : !usdc
      ? "Loading…"
      : amount <= 0n
        ? "Enter a size"
        : lacksBalance
          ? MESSAGES.insufficientBalance
          : lacksSol
            ? MESSAGES.insufficientSol
            : quote?.error ?? (quote ? null : quoteError ?? "Getting quote…");

  const swap = async (source?: TradeTicket) => {
    if (!signTransaction || blocker) return false;
    isSwappingRef.current = true;
    setIsSwapping(true);
    try {
      // Re-quote right before signing so the user signs the freshest price.
      const fresh = await fetchQuote();
      if (!fresh) return false;
      setQuote(fresh);
      if (fresh.error || !fresh.transaction) throw new Error(fresh.error ?? "This quote can't be executed.");
      const result = await jupiterVenue.executeQuote(fresh, signTransaction);
      setLastResult(result);
      toast({
        tone: "success",
        title: `${side === "buy" ? "Bought" : "Sold"} ${amountText(side === "buy" ? result.outAmount : result.inAmount, token)}`,
        message: `${side === "buy" ? "Spent" : "Received"} ${amountText(side === "buy" ? result.inAmount : result.outAmount, fresh.inputToken.mint === token.mint ? fresh.outputToken : fresh.inputToken)}`,
        link: { href: result.explorerUrl, label: "View on Solscan" },
      });
      void loadBalances();
      trackTrade({ venue: "jupiter", side, newsId: source?.newsId ?? null, oneClick: Boolean(source?.oneClick) });
      return true;
    } catch (error) {
      toast({
        tone: "error",
        title: "Swap failed",
        message: error instanceof Error ? error.message : String(error),
        link: error instanceof SwapFailedError && error.explorerUrl ? { href: error.explorerUrl, label: "View on Solscan" } : undefined,
      });
      return false;
    } finally {
      isSwappingRef.current = false;
      setIsSwapping(false);
    }
  };

  const status: PanelStatus = !address
    ? { state: "blocked", reason: "Connect a Solana wallet to trade on Jupiter." }
    : blocker === "Loading…" || blocker === "Getting quote…"
      ? { state: "loading" }
      : blocker
        ? { state: "blocked", reason: blocker }
        : { state: "ready" };

  const { confirm } = useTradeTicket();
  const { symbol: selectedSymbol } = useSelectedAsset();
  const ticket = useTicketBinding({
    venue: "spot",
    symbol: selectedSymbol,
    current: { side, sizeUsd: Number(usd) },
    apply: (nextSide, sizeUsd) => {
      setSide(nextSide);
      setUsd(String(sizeUsd));
    },
    status,
    submit: swap,
  });

  const price =
    quote && quote.inAmount > 0n && quote.outAmount > 0n
      ? side === "buy"
        ? fromBaseUnits(quote.inAmount, quote.inputToken.decimals) / fromBaseUnits(quote.outAmount, quote.outputToken.decimals)
        : fromBaseUnits(quote.outAmount, quote.outputToken.decimals) / fromBaseUnits(quote.inAmount, quote.inputToken.decimals)
      : token.usdPrice;

  return (
    <section
      aria-label="Swap"
      className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-app-hairline px-3 py-2">
        {token.icon ? <img src={token.icon} alt="" className="size-5 rounded-full" /> : <MarketIcon symbol={token.symbol} size={20} />}
        <h2 className="min-w-0 truncate text-[13px] font-semibold text-app-ink">{token.symbol} / USDC</h2>
        <span className="ml-auto rounded bg-app-chip px-1.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em] text-app-muted">
          Jupiter · Spot
        </span>
      </header>
      {venueTabs}

      <form
        className="scrollbar-subtle flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (ticket && ticket.confirmNonce === 0) confirm();
          else void swap();
        }}
      >
        <div className="flex items-center gap-1.5 text-[11px] text-app-muted">
          <span className="truncate">{token.name}</span>
          <span className="rounded bg-app-up/15 px-1 text-[10px] font-semibold text-app-up">Verified</span>
          <a
            href={`${SOLSCAN_TOKEN_URL}${token.mint}`}
            target="_blank"
            rel="noopener noreferrer"
            title={token.mint}
            className="ml-auto inline-flex items-center gap-1 font-mono tabular-nums text-app-ink hover:underline"
          >
            {shortMint(token.mint)}
            <ExternalLink className="size-3" aria-hidden />
          </a>
          <button
            type="button"
            aria-label="Copy mint address"
            onClick={() => void navigator.clipboard?.writeText(token.mint)}
            className="text-app-faint hover:text-app-ink"
          >
            <Copy className="size-3" />
          </button>
        </div>

        {ticket && <TicketBanner ticket={ticket} />}
        <div role="group" aria-label="Side" className="grid grid-cols-2 gap-1 rounded-lg bg-app-chip p-0.5">
          {(["buy", "sell"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={side === value}
              onClick={() => setSide(value)}
              className={`h-8 rounded-md text-[13px] font-semibold transition-colors ${
                side === value ? (value === "buy" ? "bg-app-up text-white" : "bg-app-down text-white") : "text-app-muted hover:text-app-ink"
              }`}
            >
              {value === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-[0.06em] text-app-muted">
          Size (USD)
          <input inputMode="decimal" value={usd} onChange={(event) => setUsd(event.target.value.replace(/[^\d.]/g, ""))} className={field} />
        </label>
        <div className="flex gap-1">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setUsd(String(preset))}
              className={`h-7 flex-1 rounded-md border text-[12px] font-semibold tabular-nums ${
                Number(usd) === preset ? "border-app-hairline-strong bg-app-card text-app-ink" : "border-app-hairline text-app-muted hover:text-app-ink"
              }`}
            >
              ${preset}
            </button>
          ))}
        </div>

        <dl className="grid grid-cols-2 gap-y-1 text-[12px]">
          <Row label="Price">{price ? formatPrice(price) : "—"}</Row>
          <Row label="You receive">{quote && outputToken ? amountText(quote.outAmount, outputToken) : "—"}</Row>
          <Row label="Minimum received">{quote && outputToken ? amountText(quote.minOutAmount, outputToken) : "—"}</Row>
          <Row label="Price impact" tone={quote && Math.abs(quote.priceImpactPct) >= 1 ? "warn" : undefined}>
            {quote ? `${quote.priceImpactPct.toFixed(2)}%` : "—"}
          </Row>
          <Row label="Slippage limit">{quote ? `${(quote.slippageBps / 100).toFixed(2)}%` : "—"}</Row>
          <Row label="Fees">{quote ? `${(quote.feeBps / 100).toFixed(2)}%` : "—"}</Row>
          <Row label="Network fee">{quote ? `${fromBaseUnits(BigInt(quote.networkFeeLamports), 9)} SOL` : "—"}</Row>
        </dl>

        {address ? (
          <button
            type="submit"
            disabled={Boolean(blocker) || isSwapping}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl px-2 text-[14px] font-semibold text-white transition-opacity disabled:opacity-50 ${
              side === "buy" ? "bg-app-up" : "bg-app-down"
            }`}
          >
            {isSwapping && <Loader2 className="size-4 animate-spin" aria-hidden />}
            <span className="truncate">{isSwapping ? "Confirm in your wallet…" : blocker ?? `${ticket && ticket.confirmNonce === 0 ? "Confirm " : ""}${side === "buy" ? "Buy" : "Sell"} ${token.symbol}`}</span>
          </button>
        ) : (
          <SolanaConnect />
        )}

        {address && (
          <div className="rounded-lg border border-app-hairline px-2.5 py-2 text-[12px]">
            <div className="flex items-center gap-2 text-app-muted">
              {wallet?.icon && <img src={wallet.icon} alt="" className="size-4 rounded" />}
              <span className="font-mono text-app-ink">{shortMint(address)}</span>
              <button type="button" onClick={() => void disconnect()} className="ml-auto font-semibold hover:text-app-ink">
                Disconnect
              </button>
            </div>
            <dl className="mt-1.5 grid grid-cols-2 gap-y-0.5">
              <Row label="USDC">{usdcBalance !== null && usdc ? amountText(usdcBalance, usdc) : "—"}</Row>
              <Row label={token.symbol}>{tokenBalance !== null ? amountText(tokenBalance, token) : "—"}</Row>
              {token.mint !== WSOL_MINT && <Row label="SOL (fees)">{balances ? `${fromBaseUnits(balances.lamports, 9)} SOL` : "—"}</Row>}
            </dl>
          </div>
        )}

        {lastResult && (
          <a
            href={lastResult.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-app-ink hover:underline"
          >
            Last swap on Solscan <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </form>
    </section>
  );
}
