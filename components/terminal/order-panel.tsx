"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { trackPerpOrder } from "@/lib/analytics/client";
import { formatPrice } from "@/lib/format";
import { estimateLiquidationPrice, marginRequired, sizeFromPercent } from "@/lib/trading/order-math";
import { sideLabel } from "@/lib/trading/presets";
import { optionalPrice, percentFrom, pnlAt, tpslError } from "@/lib/trading/tpsl";
import { arcusConfig } from "@/lib/venues/arcus/config";
import type { ArcusToken } from "@/lib/venues/arcus/tokens";
import { findMarket } from "@/lib/venues/hyperliquid/markets";
import { sizeForNotional } from "@/lib/venues/hyperliquid/pricing";
import { minimumSize } from "@/lib/venues/lighter/pricing";
import type { OrderKind, OrderSide, PerpVenueId, SpotToken, VenueMarket } from "@/lib/venues/types";
import { useOrderDraft } from "./order-draft";
import { useSelectedAsset } from "./selected-asset";
import { useTrading } from "./trading-provider";
import { fundingApr } from "@/lib/trading/funding";
import { formatUsdCompact, hourlyFundingPct, signedPercent, slippagePct } from "@/lib/trading/market-stats";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import { useArcusToken } from "./use-arcus-token";
import { takerFeeFor, useBestExecution } from "./use-best-execution";
import { useFunding } from "./use-funding";
import { useNewsTrader } from "./use-news-trader";
import { useSpotToken } from "./use-spot-token";
import { useWalletModal } from "./wallet-modal";
import { useWallet } from "./wallet-provider";

type VenueChoice =
  | { id: PerpVenueId; name: string; network: string; kind: "perp"; market: VenueMarket }
  | { id: "jupiter"; name: string; network: string; kind: "spot"; token: SpotToken }
  | { id: "arcus"; name: string; network: string; kind: "spot"; arcusToken: ArcusToken };

const ARM_MS = 5_000;
const PERCENTS = [25, 50, 75, 100];

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-lg bg-app-chip p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          disabled={disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-7 flex-1 whitespace-nowrap rounded-md text-[12px] font-semibold transition-colors disabled:opacity-50 ${
            value === option.value ? "bg-app-card text-app-ink shadow-sm" : "text-app-muted hover:text-app-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Summary({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="flex items-center justify-between text-[12px]" title={title}>
      <span className="text-app-muted">{label}</span>
      <span className="tabular-nums text-app-ink">{children}</span>
    </div>
  );
}

const fieldInput = "h-full min-w-0 flex-1 bg-transparent text-right text-[13px] tabular-nums text-app-ink outline-none placeholder:text-app-faint";

/** An input row with its label inside, like the venues' own order forms. */
function FieldBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-lg border border-app-field-border bg-app-field px-3 focus-within:border-app-ink">
      <span className="shrink-0 text-[12px] text-app-muted">{label}</span>
      {children}
    </label>
  );
}

/** Share of the available margin (× leverage) to use, with stops at every quarter. */
function PercentSlider({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (percent: number) => void }) {
  return (
    <div className={`flex items-center gap-2 ${disabled ? "opacity-50" : ""}`}>
      <div className="relative flex-1 pb-3.5">
        <input
          type="range"
          aria-label="Percent of available"
          min={0}
          max={100}
          step={1}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="relative z-10 w-full accent-[rgb(var(--app-accent))]"
        />
        <div className="absolute inset-x-0 bottom-0 flex justify-between px-0.5 text-[9px] tabular-nums text-app-faint">
          {[0, ...PERCENTS].map((stop) => (
            <button key={stop} type="button" disabled={disabled} onClick={() => onChange(stop)} className="hover:text-app-ink">
              {stop}%
            </button>
          ))}
        </div>
      </div>
      <span className="w-11 shrink-0 rounded-md border border-app-hairline py-1 text-center text-[11px] tabular-nums text-app-muted">{value}%</span>
    </div>
  );
}

/** Leverage and margin mode behind one compact button, like the venues' own forms. */
function LeverageControl({
  leverage,
  maxLeverage,
  cross,
  crossAllowed,
  onLeverage,
  onCross,
}: {
  leverage: number;
  maxLeverage: number;
  cross: boolean;
  crossAllowed: boolean;
  onLeverage: (value: number) => void;
  onCross: (value: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const presets = [1, 2, 5, 10, 20, 50].filter((value) => value < maxLeverage).concat(maxLeverage);
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 w-full items-center justify-between rounded-lg bg-app-chip px-2.5 text-[12px] font-semibold text-app-ink hover:bg-app-chip/70"
      >
        <span>
          {leverage}x <span className="font-medium text-app-muted">· {cross ? "Cross" : "Isolated"}</span>
        </span>
        <ChevronDown className={`size-3.5 text-app-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Leverage"
          className="surface-menu absolute left-0 top-10 z-30 flex w-[250px] flex-col gap-3 rounded-xl border border-app-hairline-strong bg-app-card p-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)]"
        >
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-app-muted">Leverage</span>
            <span className="font-semibold tabular-nums text-app-ink">{leverage}x</span>
          </div>
          <input
            type="range"
            aria-label="Leverage"
            min={1}
            max={maxLeverage}
            step={1}
            value={leverage}
            onChange={(event) => onLeverage(Number(event.target.value))}
            className="w-full accent-[rgb(var(--app-accent))]"
          />
          <div className="grid grid-cols-6 gap-1">
            {presets.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={leverage === value}
                onClick={() => onLeverage(value)}
                className={`h-6 rounded-md text-[11px] font-semibold tabular-nums ${
                  leverage === value ? "bg-app-ink text-app-card" : "bg-app-chip text-app-muted hover:text-app-ink"
                }`}
              >
                {value}x
              </button>
            ))}
          </div>
          <Segmented
            label="Margin mode"
            value={cross ? "cross" : "isolated"}
            disabled={!crossAllowed}
            options={[
              { value: "cross", label: "Cross", title: crossAllowed ? "Margin shared across positions" : "This market is isolated only" },
              { value: "isolated", label: "Isolated", title: "Margin kept per position" },
            ]}
            onChange={(value) => onCross(value === "cross")}
          />
        </div>
      )}
    </div>
  );
}

/** Venues that can trade the chart's asset: perps first (in the user's preferred order), then spot. */
function useVenueChoices(symbol: string, mint?: string) {
  const { preferences } = usePreferences();
  const { marketsByVenue, perpOrder, network, lighterNetwork } = useTrading();
  const token = useSpotToken(symbol, mint, preferences.venueJupiter);
  const arcusToken = useArcusToken(symbol, preferences.venueArcus && !mint);
  const choices: VenueChoice[] = [];
  for (const venue of perpOrder) {
    const list = marketsByVenue[venue];
    const market = list ? findMarket(list, symbol) : null;
    if (!market) continue;
    choices.push(
      venue === "hyperliquid"
        ? { id: venue, name: "Hyperliquid", network, kind: "perp", market }
        : { id: venue, name: "Lighter", network: lighterNetwork, kind: "perp", market },
    );
  }
  if (preferences.venueJupiter && token) choices.push({ id: "jupiter", name: "Jupiter", network: "mainnet", kind: "spot", token });
  if (arcusToken) choices.push({ id: "arcus", name: "Arcus", network: arcusConfig.network, kind: "spot", arcusToken });
  return { choices, isLoading: marketsByVenue.hyperliquid === undefined && marketsByVenue.lighter === undefined };
}

/**
 * Order entry for the chart's asset on any venue that lists it: market or limit perps (leverage, margin mode,
 * reduce-only) and market spot swaps. A press arms the order; the second press places it (one-click skips that).
 */
export function OrderPanel() {
  const { symbol, mint } = useSelectedAsset();
  const { preferences, updatePreference } = usePreferences();
  const toast = useToast();
  const { accounts, placeOrder, openDeposit } = useTrading();
  const funding = useFunding();
  const { address } = useWallet();
  const { open: openWallets } = useWalletModal();
  const { pickedPrice } = useOrderDraft();
  const trade = useNewsTrader();
  const { choices, isLoading } = useVenueChoices(symbol, mint);

  const [venueId, setVenueId] = useState<VenueChoice["id"] | null>(null);
  const [kind, setKind] = useState<OrderKind>("market");
  const [side, setSide] = useState<OrderSide>("buy");
  const [size, setSize] = useState("");
  const [limitPx, setLimitPx] = useState("");
  const [leverage, setLeverage] = useState(preferences.newsLeverage);
  const [isCross, setIsCross] = useState(true);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [withTpsl, setWithTpsl] = useState(false);
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [armed, setArmed] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);

  const perpMarkets = choices.flatMap((entry) => (entry.kind === "perp" ? [entry.market] : []));
  const manual = choices.find((entry) => entry.id === venueId) ?? null;
  const sizeValue = Number(size);
  // Reduce-only closes a position on its own venue, and limit orders rest where they are placed: no routing there.
  const routable = kind === "market" && !reduceOnly && manual?.kind !== "spot";
  const { quotes, split } = useBestExecution(perpMarkets, side, sizeValue, routable);
  const [splitOn, setSplitOn] = useState(true);
  const routed = preferences.autoRoute && routable && quotes[0] ? choices.find((entry) => entry.id === quotes[0].venue) : undefined;
  const choice = routed ?? manual ?? choices[0] ?? null;
  const pickVenue = (id: VenueChoice["id"]) => {
    setVenueId(id);
    // Picking a perp venue by hand means the user wants that venue, not the router's.
    if (preferences.autoRoute && id !== "jupiter" && id !== "arcus") updatePreference("autoRoute", false);
  };
  const market = choice?.kind === "perp" ? choice.market : null;
  const isPerp = market !== null;
  const orderKind: OrderKind = isPerp ? kind : "market";
  const maxLeverage = market?.maxLeverage ?? 1;
  const lev = isPerp ? Math.max(1, Math.min(leverage, maxLeverage)) : 1;
  const mid = market ? (market.midPx ?? market.markPx) : undefined;
  const price = orderKind === "limit" ? Number(limitPx) : mid;
  const sizeUsd = sizeValue;
  const fundingRate = market ? funding?.[market.symbol]?.[market.venue] : undefined;
  const available = market ? accounts[market.venue]?.withdrawable : undefined;
  const crossAllowed = market ? !market.onlyIsolated : false;
  const cross = crossAllowed && isCross;
  const baseSize = market && price ? sizeForNotional(sizeUsd, price, market.szDecimals) : 0;
  const liquidation =
    market && price && !cross && !reduceOnly ? estimateLiquidationPrice({ side, entry: price, leverage: lev, maxLeverage }) : null;
  // Funds on the other perp venues, for the "not enough margin here" hint.
  const marginNeeded = isPerp && sizeUsd > 0 ? marginRequired(sizeUsd, lev) : 0;
  const shortHere = market !== null && !reduceOnly && available !== undefined && marginNeeded > available;
  const fundedElsewhere = shortHere
    ? perpMarkets.find((other) => other.venue !== market.venue && (accounts[other.venue]?.withdrawable ?? 0) >= marginNeeded)
    : undefined;
  const totalAvailable = perpMarkets.reduce((sum, entry) => sum + (accounts[entry.venue]?.withdrawable ?? 0), 0);
  const tpslActive = isPerp && withTpsl && !reduceOnly;
  const tp = tpslActive ? optionalPrice(takeProfit) : undefined;
  const sl = tpslActive ? optionalPrice(stopLoss) : undefined;
  const levelsError = tpslActive && price ? tpslError({ side, reference: price, takeProfit: tp, stopLoss: sl }) : null;
  // Splitting pays off only when it saves more than noise: at least $0.25 and 0.5 bp of the order.
  const splitWorth = split !== null && preferences.autoRoute && routable && !tpslActive && split.savingsUsd >= Math.max(0.25, sizeUsd * 0.00005);
  const splitActive = splitWorth && splitOn && isPerp;
  const isValid = sizeUsd > 0 && !levelsError && (!isPerp || (Boolean(price && price > 0) && baseSize > 0));

  // A price clicked in the order book becomes the limit price.
  useEffect(() => {
    if (!pickedPrice) return;
    setKind("limit");
    setLimitPx(String(pickedPrice.price));
  }, [pickedPrice]);
  // Switching to limit starts from the mid; a new asset starts over.
  useEffect(() => {
    if (kind === "limit" && !limitPx && mid) setLimitPx(String(mid));
  }, [kind, limitPx, mid]);
  useEffect(() => {
    setLimitPx("");
    setReduceOnly(false);
    setTakeProfit("");
    setStopLoss("");
  }, [symbol, choice?.id]);
  useEffect(() => setArmed(false), [symbol, choice?.id, side, size, limitPx, kind, lev, cross, reduceOnly, takeProfit, stopLoss, withTpsl, splitActive]);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  /** Sends every leg of a split order at once; a half-filled split is reported so the user can rebalance. */
  const placeSplit = async (legs: NonNullable<typeof split>["legs"]) => {
    const orders = legs.flatMap((leg) => {
      const legMarket = perpMarkets.find((entry) => entry.venue === leg.venue);
      const legPrice = legMarket ? (legMarket.midPx ?? legMarket.markPx) : undefined;
      const legSize = legMarket && legPrice ? sizeForNotional(leg.usd, legPrice, legMarket.szDecimals) : 0;
      return legMarket && legSize > 0 ? [{ market: legMarket, size: legSize }] : [];
    });
    const results = await Promise.all(
      orders.map((order) =>
        placeOrder({
          market: order.market,
          side,
          kind: "market",
          size: order.size,
          leverage: Math.max(1, Math.min(lev, order.market.maxLeverage)),
          isCross: cross && !order.market.onlyIsolated,
        }),
      ),
    );
    orders.forEach((order, index) => {
      const result = results[index];
      if (result) trackPerpOrder(result, { venue: order.market.venue, side, newsId: null, oneClick: preferences.oneClickTrading });
    });
    if (results.some(Boolean) && !results.every(Boolean)) {
      const filled = orders.filter((_, index) => results[index]).map((order) => PERP_VENUE_NAMES[order.market.venue]);
      toast({ tone: "error", title: "Split order partly filled", message: `Only the ${filled.join(" and ")} part was placed. Check Positions and resend the rest.` });
    }
  };

  const submit = async () => {
    if (!choice || !isValid || isPlacing) return;
    if (!address && choice.id !== "jupiter") return openWallets();
    if (!armed && !preferences.oneClickTrading) return setArmed(true);
    setArmed(false);
    setIsPlacing(true);
    try {
      if (choice.kind === "spot") {
        await trade({
          symbol,
          mint: choice.id === "jupiter" ? choice.token.mint : undefined,
          venue: "spot",
          spotVenue: choice.id,
          side,
          sizeUsd,
          oneClick: preferences.oneClickTrading,
        });
        return;
      }
      if (splitActive && split) {
        await placeSplit(split.legs);
        return;
      }
      if (choice.market.venue === "lighter" && !reduceOnly && price && baseSize < minimumSize(choice.market, price)) {
        // placeOrder rejects it too, but this names the minimum in dollars.
        await trade({ symbol, venue: "perp", perpVenue: "lighter", side, sizeUsd, leverage: lev, oneClick: preferences.oneClickTrading });
        return;
      }
      const placed = await placeOrder({
        market: choice.market,
        side,
        kind: orderKind,
        size: baseSize,
        limitPx: orderKind === "limit" ? price : undefined,
        reduceOnly,
        leverage: lev,
        isCross: cross,
        takeProfit: tp,
        stopLoss: sl,
      });
      if (placed) trackPerpOrder(placed, { venue: choice.market.venue, side, newsId: null, oneClick: preferences.oneClickTrading });
    } finally {
      setIsPlacing(false);
    }
  };

  const verb = sideLabel(isPerp ? "perp" : "spot", side);
  const buttonText = !address && choice?.id !== "jupiter"
    ? "Connect wallet"
    : isPlacing
      ? "Placing…"
      : armed
        ? `Confirm ${verb.toLowerCase()}`
        : splitActive
          ? `${verb} $${sizeUsd} ${symbol} on ${split!.legs.length} venues`
          : `${verb} ${isPerp && baseSize > 0 ? `${baseSize} ${symbol}` : `$${sizeUsd > 0 ? sizeUsd : 0} ${symbol}`}`;
  const venueQuote = market ? quotes.find((quote) => quote.venue === market.venue) : undefined;
  // A split fills at the blended price of its legs.
  const splitBase = splitActive && split ? split.legs.reduce((sum, leg) => sum + leg.base, 0) : 0;
  const fillPx = splitActive && split && splitBase > 0 ? split.legs.reduce((sum, leg) => sum + leg.usd, 0) / splitBase : venueQuote?.avgPx;
  const entryPx = orderKind === "market" ? (fillPx ?? mid) : price;
  // Slippage against the best price of the same books that were walked (the market list's mid can be a minute old).
  const tops = (splitActive && split ? quotes.filter((quote) => split.legs.some((leg) => leg.venue === quote.venue)) : venueQuote ? [venueQuote] : []).map(
    (quote) => quote.topPx,
  );
  const topPx = tops.length ? (side === "buy" ? Math.min(...tops) : Math.max(...tops)) : undefined;
  const slippage = orderKind === "market" && fillPx && topPx ? slippagePct(side, topPx, fillPx) : undefined;
  const feeUsd = splitActive && split && fillPx
    ? Math.abs(split.effectivePx - fillPx) * splitBase
    : market && sizeUsd > 0
      ? (venueQuote?.feeUsd ?? sizeUsd * takerFeeFor(market))
      : undefined;
  const percent = available && available > 0 && sizeUsd > 0 ? Math.min(100, Math.round((sizeUsd / (available * lev)) * 100)) : 0;

  return (
    <section aria-label="Order entry" className="flex flex-col gap-2.5 p-3">
      {choices.length === 0 ? (
        <>
          <h3 className="text-[12px] font-semibold text-app-ink">Trade {symbol}</h3>
          <p className="text-[12px] text-app-faint">{isLoading ? "Loading markets…" : `No enabled venue lists ${symbol}. Pick another asset on the chart.`}</p>
        </>
      ) : (
        <>
          <div role="group" aria-label="Side" className="grid grid-cols-2 gap-0.5 rounded-lg bg-app-chip p-0.5">
            {(["buy", "sell"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={side === value}
                onClick={() => setSide(value)}
                className={`h-8 rounded-md text-[13px] font-semibold transition-colors ${
                  side === value
                    ? value === "buy"
                      ? "bg-app-up/20 text-app-up"
                      : "bg-app-down/20 text-app-down"
                    : "text-app-muted hover:text-app-ink"
                }`}
              >
                {sideLabel(isPerp ? "perp" : "spot", value)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {choices.length > 1 ? (
              <div className="min-w-0 flex-1">
                <Segmented
                  label="Venue"
                  value={choice!.id}
                  options={choices.map((entry) => ({ value: entry.id, label: entry.name, title: `${entry.kind === "perp" ? "Perpetual" : "Spot"} · ${entry.network}` }))}
                  onChange={pickVenue}
                />
              </div>
            ) : (
              <span className="flex-1 text-[12px] font-semibold text-app-ink">{choice!.name}</span>
            )}
            <span
              title={choice!.kind === "perp" ? "Perpetual" : "Spot"}
              className={`shrink-0 rounded px-1.5 py-[3px] text-[9px] font-semibold uppercase tracking-[0.08em] ${
                choice!.network === "mainnet" ? "bg-app-chip text-app-muted" : "bg-[#f5c97b]/15 text-[#f5c97b]"
              }`}
            >
              {choice!.network}
            </span>
          </div>
          {isPerp && (
            <div className="grid grid-cols-2 gap-2">
              <LeverageControl
                leverage={lev}
                maxLeverage={maxLeverage}
                cross={cross}
                crossAllowed={crossAllowed}
                onLeverage={setLeverage}
                onCross={setIsCross}
              />
              <Segmented
                label="Order type"
                value={kind}
                options={[
                  { value: "market", label: "Market" },
                  { value: "limit", label: "Limit" },
                ]}
                onChange={setKind}
              />
            </div>
          )}
          {orderKind === "limit" && (
            <FieldBox label="Price">
              <input
                aria-label="Limit price"
                className={fieldInput}
                inputMode="decimal"
                value={limitPx}
                onChange={(event) => setLimitPx(event.target.value.replace(/[^0-9.]/g, ""))}
              />
              {mid && (
                <button type="button" onClick={() => setLimitPx(String(mid))} className="shrink-0 text-[11px] font-semibold text-app-accent hover:underline">
                  Mid
                </button>
              )}
            </FieldBox>
          )}
          <FieldBox label="Size">
            <input
              aria-label="Size in USD"
              className={fieldInput}
              inputMode="decimal"
              placeholder="0"
              value={size}
              onChange={(event) => setSize(event.target.value.replace(/[^0-9.]/g, ""))}
            />
            <span className="shrink-0 text-[12px] font-semibold text-app-ink">USD</span>
          </FieldBox>
          <PercentSlider
            value={percent}
            disabled={!available || available <= 0}
            onChange={(next) => setSize(next > 0 && available ? String(sizeFromPercent(available, lev, next)) : "")}
          />
          {(available !== undefined || !isPerp) && (
            <Summary label="Available to trade" title={perpMarkets.length > 1 ? `All perp venues ${formatPrice(totalAvailable)}` : undefined}>
              {available !== undefined ? formatPrice(available) : "—"}
              {perpMarkets.length > 1 && totalAvailable > (available ?? 0) && <span className="text-app-faint"> · all {formatPrice(totalAvailable)}</span>}
            </Summary>
          )}
          {isPerp && (
            <>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 whitespace-nowrap text-[12px] text-app-muted">
                  <input type="checkbox" checked={reduceOnly} onChange={(event) => setReduceOnly(event.target.checked)} className="accent-[rgb(var(--app-accent))]" />
                  Reduce only
                </label>
                <label className={`flex items-center gap-2 whitespace-nowrap text-[12px] ${reduceOnly ? "text-app-faint" : "text-app-muted"}`}>
                  <input
                    type="checkbox"
                    checked={withTpsl}
                    disabled={reduceOnly}
                    onChange={(event) => setWithTpsl(event.target.checked)}
                    className="accent-[rgb(var(--app-accent))]"
                  />
                  TP / SL
                </label>
              </div>
              {tpslActive && (
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { label: "TP price", value: takeProfit, set: setTakeProfit, level: tp },
                      { label: "SL price", value: stopLoss, set: setStopLoss, level: sl },
                    ] as const
                  ).map((field) => {
                    const valid = field.level !== undefined && Number.isFinite(field.level) && price;
                    const pnl = valid ? pnlAt(side, price!, field.level!, baseSize) : null;
                    return (
                      <div key={field.label} className="flex flex-col gap-1">
                        <FieldBox label={field.label.slice(0, 2)}>
                          <input
                            aria-label={field.label}
                            className={fieldInput}
                            inputMode="decimal"
                            placeholder="Price"
                            value={field.value}
                            onChange={(event) => field.set(event.target.value.replace(/[^0-9.]/g, ""))}
                          />
                        </FieldBox>
                        <span className={`h-3.5 text-[11px] tabular-nums ${pnl === null ? "" : pnl >= 0 ? "text-app-up" : "text-app-down"}`}>
                          {valid && pnl !== null
                            ? `${percentFrom(price!, field.level!) >= 0 ? "+" : ""}${percentFrom(price!, field.level!).toFixed(2)}% · ${pnl >= 0 ? "+" : "-"}${formatPrice(Math.abs(pnl))}`
                            : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {levelsError && <p className="text-[11px] text-app-down">{levelsError}</p>}
            </>
          )}
          {shortHere && market && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-[#f5c97b]/40 bg-[#f5c97b]/10 px-2.5 py-2 text-[12px] text-app-ink">
              <span>
                Not enough margin on {PERP_VENUE_NAMES[market.venue]} ({formatPrice(available ?? 0)} available).
                {fundedElsewhere && ` ${PERP_VENUE_NAMES[fundedElsewhere.venue]} has ${formatPrice(accounts[fundedElsewhere.venue]?.withdrawable ?? 0)}.`}
              </span>
              <span className="flex flex-wrap gap-1.5">
                {fundedElsewhere && (
                  <button type="button" onClick={() => pickVenue(fundedElsewhere.venue)} className="h-7 rounded-md bg-app-card px-2.5 font-semibold hover:bg-app-chip">
                    Trade on {PERP_VENUE_NAMES[fundedElsewhere.venue]}
                  </button>
                )}
                {market.venue === "lighter" && fundedElsewhere?.venue === "hyperliquid" ? (
                  <button type="button" onClick={() => openDeposit("lighter", "move")} className="h-7 rounded-md bg-app-card px-2.5 font-semibold hover:bg-app-chip">
                    Move funds to Lighter
                  </button>
                ) : (
                  <button type="button" onClick={() => openDeposit(market.venue)} className="h-7 rounded-md bg-app-card px-2.5 font-semibold hover:bg-app-chip">
                    Deposit to {PERP_VENUE_NAMES[market.venue]}
                  </button>
                )}
              </span>
            </div>
          )}
          {quotes.length > 1 && (
            <div className="flex flex-col gap-0.5 rounded-lg border border-app-hairline p-1.5">
              <div className="flex items-center justify-between px-1 text-[11px]">
                <span className="font-medium text-app-muted">Best price</span>
                <label className="flex items-center gap-1.5 text-app-muted" title="Send market orders to the venue with the best estimated fill after fees">
                  <input
                    type="checkbox"
                    checked={preferences.autoRoute}
                    onChange={(event) => updatePreference("autoRoute", event.target.checked)}
                    className="accent-[rgb(var(--app-accent))]"
                  />
                  Auto-route
                </label>
              </div>
              {quotes.map((quote, index) => (
                <button
                  key={quote.venue}
                  type="button"
                  onClick={() => pickVenue(quote.venue)}
                  aria-pressed={choice?.id === quote.venue}
                  className={`grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md px-1 py-0.5 text-[11px] tabular-nums transition-colors hover:bg-app-chip ${
                    choice?.id === quote.venue ? "bg-app-chip" : ""
                  }`}
                  title={`Avg. fill ${formatPrice(quote.avgPx)} + fees ${formatPrice(quote.feeUsd)}${quote.complete ? "" : " (book too thin for the whole size)"}`}
                >
                  <span className="text-left font-semibold text-app-ink">{PERP_VENUE_NAMES[quote.venue]}</span>
                  <span className="text-app-muted">
                    {formatPrice(quote.avgPx)}
                    {!quote.complete && " · thin"}
                  </span>
                  <span className={`w-14 text-right ${index === 0 ? "font-semibold text-app-up" : "text-app-down"}`}>
                    {index === 0 ? "Best" : `+${formatPrice(quote.costVsBestUsd)}`}
                  </span>
                </button>
              ))}
              {splitWorth && split && (
                <label
                  className="mt-0.5 flex items-center gap-2 rounded-md border-t border-app-hairline px-1 pt-1.5 text-[11px] tabular-nums"
                  title="Fill part of the order on each venue, taking the cheapest prices of both books after fees"
                >
                  <input type="checkbox" checked={splitOn} onChange={(event) => setSplitOn(event.target.checked)} className="accent-[rgb(var(--app-accent))]" />
                  <span className="min-w-0 flex-1 truncate text-app-ink">
                    Split {split.legs.map((leg) => `${leg.venue === "hyperliquid" ? "HL" : "Lighter"} ${formatUsdCompact(leg.usd)}`).join(" + ")}
                  </span>
                  <span className="shrink-0 font-semibold text-app-up">−{formatPrice(split.savingsUsd)}</span>
                </label>
              )}
            </div>
          )}
          {choice?.id === "jupiter" && <p className="text-[11px] text-app-faint">Jupiter swaps are on Solana mainnet with real funds.</p>}
          {choice?.id === "arcus" && (
            <p className="text-[11px] text-app-faint">
              {choice.arcusToken.name} on Robinhood Chain {arcusConfig.network}, paid in {arcusConfig.quoteSymbol}. Minimum $5.
            </p>
          )}
          <button
            type="button"
            disabled={(address || choice?.id === "jupiter" ? !isValid : false) || isPlacing}
            onClick={() => void submit()}
            className={`h-10 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50 ${
              !address && choice?.id !== "jupiter"
                ? "bg-app-accent text-app-on-accent hover:opacity-90"
                : isBuy(side)
                  ? "bg-app-up/90 text-black hover:bg-app-up"
                  : "bg-app-down/90 text-white hover:bg-app-down"
            } ${armed ? "ring-2 ring-app-ink ring-offset-1 ring-offset-transparent" : ""}`}
          >
            {buttonText}
          </button>
          {isPerp && (
            <div className="flex flex-col gap-1.5 border-t border-app-hairline pt-2.5">
              <Summary label={orderKind === "market" ? "Est. entry price" : "Entry price"}>{entryPx ? formatPrice(entryPx) : "—"}</Summary>
              {orderKind === "market" && (
                <Summary label="Est. slippage" title="Average fill vs the best price in the live order books">
                  {slippage === undefined ? "—" : `${slippage.toFixed(3)}%`}
                </Summary>
              )}
              <Summary label="Fees" title="Taker fee incl. builder / integrator fee">
                {feeUsd === undefined ? "—" : feeUsd < 0.005 ? "$0.00" : formatPrice(feeUsd)}
              </Summary>
              <Summary label="Margin required">{sizeUsd > 0 ? formatPrice(marginRequired(sizeUsd, lev)) : "—"}</Summary>
              <Summary label="Est. liquidation" title={cross ? "Cross margin: depends on the whole account" : "Estimate for an isolated position"}>
                {sizeUsd > 0 ? (cross ? "Account-wide" : liquidation ? formatPrice(liquidation) : "—") : "—"}
              </Summary>
              <Summary
                label="Funding (1h)"
                title={fundingRate === undefined ? undefined : `Mainnet funding, ${fundingApr(fundingRate).toFixed(2)}% APR. Positive: longs pay shorts.`}
              >
                <span className={fundingRate === undefined ? "" : fundingRate >= 0 ? "text-app-up" : "text-app-down"}>
                  {fundingRate === undefined ? "—" : signedPercent(hourlyFundingPct(fundingRate), 4)}
                </span>
              </Summary>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function isBuy(side: OrderSide) {
  return side === "buy";
}
