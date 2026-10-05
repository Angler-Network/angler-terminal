"use client";

import { useEffect, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { trackTrade } from "@/lib/analytics/client";
import { formatPrice } from "@/lib/format";
import { estimateLiquidationPrice, marginRequired, sizeFromPercent } from "@/lib/trading/order-math";
import { sideLabel } from "@/lib/trading/presets";
import { arcusConfig } from "@/lib/venues/arcus/config";
import type { ArcusToken } from "@/lib/venues/arcus/tokens";
import { findMarket } from "@/lib/venues/hyperliquid/markets";
import { sizeForNotional } from "@/lib/venues/hyperliquid/pricing";
import { minimumSize } from "@/lib/venues/lighter/pricing";
import type { OrderKind, OrderSide, PerpVenueId, SpotToken, VenueMarket } from "@/lib/venues/types";
import { useOrderDraft } from "./order-draft";
import { useSelectedAsset } from "./selected-asset";
import { useTrading } from "./trading-provider";
import { useArcusToken } from "./use-arcus-token";
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

const inputClass =
  "h-9 w-full min-w-0 rounded-lg border border-app-field-border bg-app-field px-2.5 text-[13px] tabular-nums text-app-ink outline-none focus:border-app-ink";

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
          className={`h-7 flex-1 rounded-md text-[12px] font-semibold transition-colors disabled:opacity-50 ${
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
  const { preferences } = usePreferences();
  const { accounts, placeOrder } = useTrading();
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
  const [armed, setArmed] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);

  const choice = choices.find((entry) => entry.id === venueId) ?? choices[0] ?? null;
  const market = choice?.kind === "perp" ? choice.market : null;
  const isPerp = market !== null;
  const orderKind: OrderKind = isPerp ? kind : "market";
  const maxLeverage = market?.maxLeverage ?? 1;
  const lev = isPerp ? Math.max(1, Math.min(leverage, maxLeverage)) : 1;
  const mid = market ? (market.midPx ?? market.markPx) : undefined;
  const price = orderKind === "limit" ? Number(limitPx) : mid;
  const sizeUsd = Number(size);
  const available = market ? accounts[market.venue]?.withdrawable : undefined;
  const crossAllowed = market ? !market.onlyIsolated : false;
  const cross = crossAllowed && isCross;
  const baseSize = market && price ? sizeForNotional(sizeUsd, price, market.szDecimals) : 0;
  const liquidation =
    market && price && !cross && !reduceOnly ? estimateLiquidationPrice({ side, entry: price, leverage: lev, maxLeverage }) : null;
  const isValid = sizeUsd > 0 && (!isPerp || (Boolean(price && price > 0) && baseSize > 0));

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
  }, [symbol, choice?.id]);
  useEffect(() => setArmed(false), [symbol, choice?.id, side, size, limitPx, kind, lev, cross, reduceOnly]);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

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
      });
      if (placed) trackTrade({ venue: choice.market.venue, side, newsId: null, oneClick: preferences.oneClickTrading });
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
        : `${verb} ${isPerp && baseSize > 0 ? `${baseSize} ${symbol}` : `$${sizeUsd > 0 ? sizeUsd : 0} ${symbol}`}`;

  return (
    <section aria-label="Order entry" className="flex flex-col gap-2.5 p-3">
      <header className="flex items-center gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-app-muted">Trade {symbol}</h3>
        {choice && (
          <span className="ml-auto rounded bg-app-chip px-1.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em] text-app-muted">
            {choice.network}
          </span>
        )}
      </header>
      {choices.length === 0 ? (
        <p className="text-[12px] text-app-faint">{isLoading ? "Loading markets…" : `No enabled venue lists ${symbol}. Pick another asset on the chart.`}</p>
      ) : (
        <>
          {choices.length > 1 && (
            <Segmented
              label="Venue"
              value={choice!.id}
              options={choices.map((entry) => ({ value: entry.id, label: entry.name, title: entry.kind === "perp" ? "Perpetual" : "Spot" }))}
              onChange={setVenueId}
            />
          )}
          {isPerp && (
            <Segmented
              label="Order type"
              value={kind}
              options={[
                { value: "market", label: "Market" },
                { value: "limit", label: "Limit" },
              ]}
              onChange={setKind}
            />
          )}
          <div role="group" aria-label="Side" className="grid grid-cols-2 gap-1">
            {(["buy", "sell"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={side === value}
                onClick={() => setSide(value)}
                className={`h-9 rounded-lg border text-[13px] font-semibold transition-colors ${
                  side === value
                    ? value === "buy"
                      ? "border-app-up/60 bg-app-up/15 text-app-up"
                      : "border-app-down/60 bg-app-down/15 text-app-down"
                    : "border-app-hairline text-app-muted hover:text-app-ink"
                }`}
              >
                {sideLabel(isPerp ? "perp" : "spot", value)}
              </button>
            ))}
          </div>
          {orderKind === "limit" && (
            <label className="flex flex-col gap-1 text-[11px] text-app-muted">
              <span className="flex items-center justify-between">
                Limit price
                {mid && (
                  <button type="button" onClick={() => setLimitPx(String(mid))} className="font-semibold text-app-ink hover:underline">
                    Mid {formatPrice(mid)}
                  </button>
                )}
              </span>
              <input className={inputClass} inputMode="decimal" value={limitPx} onChange={(event) => setLimitPx(event.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-[11px] text-app-muted">
            <span className="flex items-center justify-between">
              Size (USD)
              {available !== undefined && <span>Available {formatPrice(available)}</span>}
            </span>
            <input
              className={inputClass}
              inputMode="decimal"
              placeholder={isPerp ? "Order value" : "Amount"}
              value={size}
              onChange={(event) => setSize(event.target.value.replace(/[^0-9.]/g, ""))}
            />
          </label>
          {available !== undefined && available > 0 && (
            <div className="grid grid-cols-4 gap-1">
              {PERCENTS.map((percent) => (
                <button
                  key={percent}
                  type="button"
                  onClick={() => setSize(String(sizeFromPercent(available, lev, percent)))}
                  className="h-7 rounded-md border border-app-hairline text-[11px] font-semibold text-app-muted transition-colors hover:bg-app-chip hover:text-app-ink"
                >
                  {percent}%
                </button>
              ))}
            </div>
          )}
          {isPerp && (
            <>
              <label className="flex flex-col gap-1 text-[11px] text-app-muted">
                <span className="flex items-center justify-between">
                  Leverage
                  <span className="font-semibold tabular-nums text-app-ink">{lev}x</span>
                </span>
                <input
                  type="range"
                  min={1}
                  max={maxLeverage}
                  step={1}
                  value={lev}
                  onChange={(event) => setLeverage(Number(event.target.value))}
                  className="w-full accent-[rgb(var(--app-accent))]"
                />
              </label>
              <Segmented
                label="Margin mode"
                value={cross ? "cross" : "isolated"}
                disabled={!crossAllowed}
                options={[
                  { value: "cross", label: "Cross", title: crossAllowed ? "Margin shared across positions" : "This market is isolated only" },
                  { value: "isolated", label: "Isolated", title: "Margin kept per position" },
                ]}
                onChange={(value) => setIsCross(value === "cross")}
              />
              <label className="flex items-center gap-2 text-[12px] text-app-muted">
                <input type="checkbox" checked={reduceOnly} onChange={(event) => setReduceOnly(event.target.checked)} className="accent-[rgb(var(--app-accent))]" />
                Reduce only
              </label>
            </>
          )}
          {isPerp && sizeUsd > 0 && (
            <div className="flex flex-col gap-1 rounded-lg bg-app-chip/50 px-2.5 py-2">
              <Summary label="Order value">{formatPrice(sizeUsd)}</Summary>
              <Summary label="Margin required">{formatPrice(marginRequired(sizeUsd, lev))}</Summary>
              <Summary label="Est. liquidation" title={cross ? "Cross margin: depends on the whole account" : "Estimate for an isolated position"}>
                {cross ? "Account-wide" : liquidation ? formatPrice(liquidation) : "—"}
              </Summary>
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
              isBuy(side) ? "bg-app-up/90 text-black hover:bg-app-up" : "bg-app-down/90 text-white hover:bg-app-down"
            } ${armed ? "ring-2 ring-app-ink ring-offset-1 ring-offset-transparent" : ""}`}
          >
            {buttonText}
          </button>
        </>
      )}
    </section>
  );
}

function isBuy(side: OrderSide) {
  return side === "buy";
}
