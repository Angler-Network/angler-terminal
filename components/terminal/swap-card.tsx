"use client";

import { ArrowDown } from "lucide-react";
import { useEffect, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { venueAvailable } from "@/lib/deployment";
import { formatPrice } from "@/lib/format";
import { normalizeSpotSymbol } from "@/lib/spot/listings";
import { estimateReceive, shareOf, swapSizeUsd } from "@/lib/trading/swap";
import { arcusQuoteToken, call } from "@/lib/venues/arcus/catalog";
import { ARCUS_MIN_NOTIONAL_USD, arcusConfig } from "@/lib/venues/arcus/config";
import type { ArcusToken } from "@/lib/venues/arcus/tokens";
import { fromBaseUnits } from "@/lib/venues/jupiter/amounts";
import { spendableBalance } from "@/lib/venues/jupiter/balances";
import { jupiterVenue } from "@/lib/venues/jupiter/venue";
import type { OrderSide, SpotToken } from "@/lib/venues/types";
import { useAssetSearch } from "./asset-search";
import { Picker, type PickerOption } from "./inline-picker";
import { useSelectedAsset } from "./selected-asset";
import { useSolanaWallet } from "./solana-wallet-provider";
import { CoinIcon } from "./token-icon";
import { useNewsTrader } from "./use-news-trader";
import { useSpotQuotes, type SpotSource, type SpotSourceQuote } from "./use-spot-quotes";
import { useWalletModal } from "./wallet-modal";
import { useWallet } from "./wallet-provider";

/** A spot venue that lists the chart's asset: Solana through the aggregators (Jupiter, Titan), or Arcus on Robinhood. */
export type SpotChoice =
  | { id: "solana"; name: string; network: string; kind: "spot"; token: SpotToken }
  | { id: "arcus"; name: string; network: string; kind: "spot"; arcusToken: ArcusToken };

const ARM_MS = 5_000;
const BALANCE_REFRESH_MS = 15_000;
const SHARES = [25, 50, 75, 100];
const SOURCE_NAMES: Record<SpotSource, string> = { jupiter: "Jupiter", titan: "Titan" };
const OTHER_TOKEN = "__other";

/** The wallet's stablecoin and asset balances on the choice's chain, refreshed while the tab is visible. */
function useSwapBalances(choice: SpotChoice, owner: string | null, refresh: number) {
  const assetId = choice.id === "solana" ? choice.token.mint : choice.arcusToken.address;
  const key = `${choice.id}:${assetId}:${owner}:${refresh}`;
  const [state, setState] = useState<{ key: string; stable: number; asset: number } | null>(null);
  useEffect(() => {
    if (!owner) return;
    let active = true;
    const load = async () => {
      try {
        if (choice.id === "solana") {
          const usdc = await jupiterVenue.quoteToken();
          const held = await jupiterVenue.getBalances(owner, [usdc.mint, choice.token.mint]);
          const stable = fromBaseUnits(held.tokens[usdc.mint] ?? 0n, usdc.decimals);
          const asset = fromBaseUnits(spendableBalance(choice.token.mint, held.tokens, held.lamports), choice.token.decimals);
          if (active) setState({ key, stable, asset });
        } else {
          const [stableToken, { getArcusBalances }] = await Promise.all([arcusQuoteToken(), import("@/lib/venues/arcus/venue")]);
          const held = await getArcusBalances(owner as `0x${string}`, [stableToken, choice.arcusToken]);
          const stable = fromBaseUnits(held[stableToken.address] ?? 0n, stableToken.decimals);
          const asset = fromBaseUnits(held[choice.arcusToken.address] ?? 0n, choice.arcusToken.decimals);
          if (active) setState({ key, stable, asset });
        }
      } catch {}
    };
    void load();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void load(), BALANCE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // The key covers the choice, the wallet and manual refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return owner && state?.key === key ? state : null;
}

/** Arcus's indicative price for a stock token in USDG (what $100 buys), refreshed every few seconds. */
function useArcusPrice(token: ArcusToken | null) {
  const [state, setState] = useState<{ address: string; price: number } | null>(null);
  useEffect(() => {
    if (!token) return;
    let active = true;
    const load = async () => {
      try {
        const stable = await arcusQuoteToken();
        const spend = 100;
        const body = await call<{ all?: Array<{ venue: string; buyAmount: string }> }>(
          `price?${new URLSearchParams({
            chainId: String(arcusConfig.chainId),
            sellToken: stable.address,
            buyToken: token.address,
            sellAmount: String(spend * 10 ** stable.decimals),
          })}`,
        );
        const entry = body.all?.find((row) => row.venue === "arcus");
        const bought = entry ? fromBaseUnits(BigInt(entry.buyAmount), token.decimals) : 0;
        if (active && bought > 0) setState({ address: token.address, price: spend / bought });
      } catch {}
    };
    void load();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void load(), BALANCE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [token]);
  return token && state?.address === token.address ? state.price : undefined;
}

/**
 * Quotes from each Solana source for the size, best first. With no pick the best one is used; pressing a row pins
 * that source, pressing it again goes back to the best.
 */
function SpotRoutes({ quotes, loading, pick, onPick }: { quotes: SpotSourceQuote[]; loading: boolean; pick: SpotSource | null; onPick: (source: SpotSource | null) => void }) {
  const best = quotes[0]?.outAmount ?? null;
  const selected = pick ?? quotes.find((quote) => quote.outAmount !== null)?.source ?? null;
  return (
    <div className="overflow-hidden rounded-xl border border-app-hairline">
      <div className="flex items-center gap-2 border-b border-app-hairline bg-app-chip/40 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.06em] text-app-faint">
        <span>Route</span>
        {loading && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-app-accent" />}
      </div>
      {quotes.map((quote, index) => {
        const amount = quote.outAmount !== null && quote.outputToken ? fromBaseUnits(quote.outAmount, quote.outputToken.decimals) : null;
        const gap = quote.outAmount !== null && best !== null && best > 0n && index > 0 ? (Number(best - quote.outAmount) / Number(best)) * 100 : 0;
        const isSelected = selected === quote.source;
        return (
          <button
            key={quote.source}
            type="button"
            disabled={quote.outAmount === null}
            onClick={() => onPick(pick === quote.source ? null : quote.source)}
            title={quote.note ?? (pick === quote.source ? "Pinned: press again to follow the best quote" : "Swap on this route")}
            className={`flex h-8 w-full items-center gap-2 border-t border-app-hairline px-2.5 text-left text-[12px] transition-colors first:border-t-0 disabled:cursor-default ${
              isSelected ? "bg-app-accent/10" : "hover:bg-app-chip/60"
            }`}
          >
            <span aria-hidden className={`grid size-3 shrink-0 place-items-center rounded-full border ${isSelected ? "border-app-accent" : "border-app-hairline-strong"}`}>
              {isSelected && <span className="size-1.5 rounded-full bg-app-accent" />}
            </span>
            <span className={`font-semibold ${quote.outAmount === null ? "text-app-muted" : "text-app-ink"}`}>{SOURCE_NAMES[quote.source]}</span>
            {index === 0 && quote.outAmount !== null && (
              <span className="rounded bg-app-up/15 px-1 text-[9px] font-bold uppercase tracking-[0.06em] text-app-up">Best</span>
            )}
            {pick === quote.source && <span className="text-[10px] text-app-faint">pinned</span>}
            <span className="ml-auto min-w-0 truncate text-right tabular-nums">
              {amount !== null ? (
                <span className="text-app-ink">
                  {amount.toLocaleString("en-US", { maximumSignificantDigits: 6 })} {quote.outputToken?.symbol}
                </span>
              ) : (
                <span className="text-[11px] text-app-faint">{quote.note}</span>
              )}
            </span>
            {gap > 0 && <span className="shrink-0 text-[11px] tabular-nums text-app-down">-{gap.toFixed(2)}%</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Long amounts shrink so the token pill keeps its place in the narrow trading column. */
const amountSize = (text: string) => (text.length > 9 ? "text-[16px]" : text.length > 6 ? "text-[19px]" : "text-[22px]");
const amountText = (value: number) => value.toLocaleString("en-US", { maximumSignificantDigits: value < 1 ? 4 : 6 });
const pillClass = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-app-chip pl-1.5 pr-2.5 text-[14px] font-semibold text-app-ink";

/**
 * Spot is a swap: "Sell [amount] [token] → Buy [token]" like the venues' own swap screens. The asset side lists every
 * spot venue that has the chart's asset (a Solana token through Jupiter/Titan, an Arcus stock token on Robinhood
 * Chain) plus a way to pick another token; the stablecoin side is the venue's (USDC on Solana, USDG on Robinhood).
 * The arrow flips the direction. Execution is the same as news trades (`use-news-trader.ts`, sized in USD), behind a
 * confirm press unless one-click is on.
 */
export function SwapCard({ choices }: { choices: SpotChoice[] }) {
  const { symbol } = useSelectedAsset();
  const { preferences } = usePreferences();
  const { address: evmAddress } = useWallet();
  const { address: solanaAddress } = useSolanaWallet();
  const { open: openWallets } = useWalletModal();
  const { open: openSearch } = useAssetSearch();
  const trade = useNewsTrader();
  const [venueId, setVenueId] = useState<SpotChoice["id"] | null>(null);
  const [side, setSide] = useState<OrderSide>("buy");
  const [amount, setAmount] = useState("");
  const [pick, setPick] = useState<SpotSource | null>(null);
  const [armed, setArmed] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const choice = choices.find((entry) => entry.id === venueId) ?? choices[0];
  const isSolana = choice.id === "solana";
  const owner = isSolana ? solanaAddress : evmAddress;
  const asset = isSolana
    ? { symbol: choice.token.symbol, icon: choice.token.icon, chain: "solana" as const, chainName: "Solana", kind: undefined }
    : { symbol: choice.arcusToken.symbol, icon: undefined, chain: arcusConfig.chainId, chainName: "Robinhood", kind: "stock" as const };
  const stable = isSolana ? { symbol: "USDC", chain: "solana" as const, chainName: "Solana" } : { symbol: arcusConfig.quoteSymbol, chain: arcusConfig.chainId, chainName: "Robinhood" };
  const arcusPrice = useArcusPrice(isSolana ? null : choice.arcusToken);
  const price = isSolana ? choice.token.usdPrice : arcusPrice;
  const balances = useSwapBalances(choice, owner, refresh);

  const value = Number(amount);
  const sizeUsd = swapSizeUsd(side, value, price);
  const { quotes, loading } = useSpotQuotes({
    token: isSolana ? choice.token : null,
    side,
    sizeUsd,
    taker: solanaAddress,
    titan: preferences.venueTitan && venueAvailable("titan"),
  });
  const selected = pick ? quotes.find((quote) => quote.source === pick) : quotes.find((quote) => quote.outAmount !== null);
  const quoted = selected?.outAmount != null && selected.outputToken ? fromBaseUnits(selected.outAmount, selected.outputToken.decimals) : null;
  const receive = sizeUsd > 0 ? (quoted ?? estimateReceive(side, value, price)) : null;
  const sell = side === "buy" ? stable : asset;
  const buy = side === "buy" ? asset : stable;
  const sellBalance = balances ? (side === "buy" ? balances.stable : balances.asset) : null;
  const receiveUsd = receive === null ? null : side === "buy" ? (price ? receive * price : null) : receive;
  // What one asset token costs in this swap (the quote's own rate once it's in).
  const rate = receive && value > 0 ? (side === "buy" ? value / receive : receive / value) : price;
  const error = !(value > 0)
    ? null
    : sellBalance !== null && value > sellBalance + 1e-9
      ? `Not enough ${sell.symbol} on ${sell.chainName}.`
      : side === "sell" && !price
        ? `No ${asset.symbol} price yet.`
        : !isSolana && sizeUsd < ARCUS_MIN_NOTIONAL_USD
          ? `Arcus needs at least $${ARCUS_MIN_NOTIONAL_USD} per swap.`
          : null;
  const canSwap = Boolean(owner) && sizeUsd > 0 && !error && !isPlacing;

  useEffect(() => setArmed(false), [symbol, choice.id, side, amount, pick]);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);
  useEffect(() => setAmount(""), [symbol]);

  const flip = () => {
    setSide((current) => (current === "buy" ? "sell" : "buy"));
    // The amount that would have come out goes in, like the venues' own swap screens.
    setAmount(receive && receive > 0 ? String(Number(receive.toPrecision(6))) : "");
  };

  const submit = async () => {
    if (!owner) return openWallets();
    if (!canSwap) return;
    if (!armed && !preferences.oneClickTrading) return setArmed(true);
    setArmed(false);
    setIsPlacing(true);
    try {
      const placed = await trade({
        symbol,
        mint: isSolana ? choice.token.mint : undefined,
        spotSource: isSolana ? (pick ?? "best") : undefined,
        venue: "spot",
        spotVenue: isSolana ? "jupiter" : "arcus",
        side,
        sizeUsd,
        oneClick: preferences.oneClickTrading,
      });
      if (placed) setAmount("");
      setRefresh((count) => count + 1);
    } finally {
      setIsPlacing(false);
    }
  };

  const assetOptions: Array<PickerOption<string>> = [
    ...choices.map((entry) =>
      entry.id === "solana"
        ? { value: entry.id, label: `${entry.token.symbol} · Solana`, icon: <CoinIcon src={entry.token.icon} symbol={entry.token.symbol} chain="solana" size={20} /> }
        : {
            value: entry.id,
            label: `${entry.arcusToken.symbol} · Robinhood`,
            icon: <CoinIcon symbol={entry.arcusToken.symbol} kind="stock" chain={arcusConfig.chainId} size={20} />,
            note: entry.network === "mainnet" ? undefined : entry.network,
          },
    ),
    { value: OTHER_TOKEN, label: "Other token…" },
  ];
  const assetPill = (
    <Picker
      label="Token"
      value={choice.id}
      options={assetOptions}
      onChange={(next) => (next === OTHER_TOKEN ? openSearch() : setVenueId(next as SpotChoice["id"]))}
      buttonClassName={`${pillClass} hover:bg-app-selected`}
    >
      <CoinIcon src={asset.icon} symbol={asset.symbol} kind={asset.kind} chain={asset.chain} size={24} />
      <span className="flex flex-col items-start leading-tight">
        {asset.symbol}
        <span className="text-[10px] font-medium text-app-muted">{asset.chainName}</span>
      </span>
    </Picker>
  );
  const stablePill = (
    <span className={pillClass} title={`${stable.symbol} on ${stable.chainName}, the dollar this venue trades against`}>
      <CoinIcon symbol={stable.symbol} chain={stable.chain} size={24} />
      <span className="flex flex-col items-start leading-tight">
        {stable.symbol}
        <span className="text-[10px] font-medium text-app-muted">{stable.chainName}</span>
      </span>
    </span>
  );
  const box = "flex flex-col gap-2 rounded-2xl border border-app-hairline bg-app-chip/30 p-3";
  const walletName = isSolana ? "Solana" : "EVM";

  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative flex flex-col gap-1">
        <div className={box}>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-app-muted">Sell</span>
            {sellBalance !== null && (
              <span className="text-app-faint">
                Balance <span className="font-semibold tabular-nums text-app-ink">{amountText(sellBalance)}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              aria-label={`${sell.symbol} to sell`}
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
              className={`min-w-0 flex-1 bg-transparent ${amountSize(amount)} font-semibold tabular-nums text-app-ink outline-hidden placeholder:text-app-faint`}
            />
            {side === "buy" ? stablePill : assetPill}
          </div>
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="mr-auto tabular-nums text-app-faint">{sizeUsd > 0 ? `≈ ${formatPrice(sizeUsd)}` : "$0.00"}</span>
            {sellBalance !== null &&
              SHARES.map((share) => (
                <button
                  key={share}
                  type="button"
                  onClick={() => setAmount(shareOf(sellBalance, share, side === "buy" ? 6 : 8))}
                  className="h-6 rounded-full bg-app-chip px-2 text-[11px] font-semibold text-app-muted hover:text-app-ink"
                >
                  {share === 100 ? "Max" : `${share}%`}
                </button>
              ))}
          </div>
        </div>
        <button
          type="button"
          onClick={flip}
          aria-label="Flip direction"
          title="Flip direction"
          className="absolute left-1/2 top-1/2 z-10 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-lg border border-app-hairline-strong bg-app-card text-app-muted hover:text-app-ink"
        >
          <ArrowDown className="size-4" aria-hidden />
        </button>
        <div className={box}>
          <span className="text-[12px] text-app-muted">Buy</span>
          <div className="flex items-center gap-2">
            <span className={`min-w-0 flex-1 truncate ${amountSize(receive ? amountText(receive) : "0")} font-semibold tabular-nums ${receive ? "text-app-ink" : "text-app-faint"}`}>
              {receive ? amountText(receive) : "0"}
            </span>
            {side === "buy" ? assetPill : stablePill}
          </div>
          <span className="text-[12px] tabular-nums text-app-faint">{receiveUsd ? `≈ ${formatPrice(receiveUsd)}` : "$0.00"}</span>
        </div>
      </div>

      {isSolana && normalizeSpotSymbol(choice.token.symbol) !== normalizeSpotSymbol(symbol) && (
        // The asset has no token of its own name on Solana: say which token the swap actually trades.
        <p className="text-[11px] leading-snug text-app-faint">
          Trades <span className="font-semibold text-app-muted">{choice.token.symbol}</span> ({choice.token.name}), the most traded {symbol} on Solana right now.
        </p>
      )}
      {rate && (
        <p className="text-[12px] tabular-nums text-app-muted">
          1 {asset.symbol} ≈ {formatPrice(rate)} {stable.symbol}
          <span className="text-app-faint"> · {isSolana ? "Jupiter / Titan, best route" : `Arcus on Robinhood Chain${arcusConfig.network === "mainnet" ? "" : ` ${arcusConfig.network}`}, gasless`}</span>
        </p>
      )}
      {isSolana && sizeUsd > 0 && quotes.length > 1 && <SpotRoutes quotes={quotes} loading={loading} pick={pick} onPick={setPick} />}
      {error && <p className="text-[12px] text-app-down">{error}</p>}

      <button
        type="button"
        disabled={Boolean(owner) && !canSwap}
        onClick={() => void submit()}
        className={`h-11 rounded-xl text-[14px] font-semibold transition-colors disabled:opacity-50 ${
          armed ? "bg-app-ink text-app-card" : "bg-app-accent text-app-on-accent hover:opacity-90"
        }`}
      >
        {!owner
          ? `Connect ${walletName} wallet`
          : isPlacing
            ? "Confirm in your wallet…"
            : armed
              ? `Confirm: ${amountText(value)} ${sell.symbol} → ${buy.symbol}`
              : value > 0
                ? `Swap ${amountText(value)} ${sell.symbol} → ${buy.symbol}`
                : "Enter an amount"}
      </button>
    </div>
  );
}
