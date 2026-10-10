"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { usePreferences } from "@/components/app/preferences-provider";
import { SearchableSelect } from "@/components/app/searchable-select";
import { useToast } from "@/components/app/toast-provider";
import { trackPerpOrder } from "@/lib/analytics/client";
import { formatPrice } from "@/lib/format";
import { hedgeLegs, MAX_PRO_LEGS, planLegs, type LegPlan, type ProLeg } from "@/lib/trading/pro-order";
import { findMarket } from "@/lib/venues/hyperliquid/markets";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { OrderSide, PerpVenueId, VenueMarket } from "@/lib/venues/types";
import { useSelectedAsset } from "./selected-asset";
import { useTrading } from "./trading-provider";
import { minOrderUsd, takerFeeFor } from "./use-best-execution";
import { useWalletModal } from "./wallet-modal";
import { useWallet } from "./wallet-provider";
import { useModalEnter } from "@/components/app/use-motion";
import { RangeSlider } from "@/components/app/range-slider";
import { VenueLogo } from "@/components/terminal/venue-logo";
import { SelectField } from "@/components/app/select-field";

type Mode = "hedge" | "multi";

const ARM_MS = 5_000;
const PRO = "rgb(var(--app-accent))";

const field =
  "h-9 w-full min-w-0 rounded-lg border border-app-field-border bg-app-field px-2.5 text-[13px] tabular-nums text-app-ink outline-hidden focus:border-app-ink";

function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-lg bg-app-chip p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-7 flex-1 rounded-md px-2 text-[12px] font-semibold ${value === option.value ? "bg-app-card text-app-ink shadow-xs" : "text-app-muted hover:text-app-ink"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function CoinPicker({ symbols, value, onChange }: { symbols: string[]; value: string; onChange: (symbol: string) => void }) {
  return (
    <SearchableSelect
      compact
      items={symbols}
      value={value}
      onChange={(next) => next && onChange(next)}
      getKey={(symbol) => symbol}
      getSearchText={(symbol) => symbol}
      getDisplayValue={(symbol) => symbol}
      renderSelectedIcon={(symbol) => <MarketIcon symbol={symbol} size={18} />}
      renderOption={(symbol) => (
        <>
          <MarketIcon symbol={symbol} size={20} />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-app-ink">{symbol}</span>
        </>
      )}
      label="Coin"
      placeholder="Coin"
      searchPlaceholder="Search, e.g. BTC"
      emptyMessage="No perp lists it."
    />
  );
}

function VenueSelect({ venues, value, onChange, label }: { venues: PerpVenueId[]; value: PerpVenueId; onChange: (venue: PerpVenueId) => void; label: string }) {
  return (
    <SelectField<PerpVenueId>
      size="sm"
      rootClassName="w-full"
      className="w-full"
      label={label}
      value={value}
      onChange={onChange}
      options={venues.map((venue) => ({ value: venue, label: PERP_VENUE_NAMES[venue], icon: <VenueLogo name={PERP_VENUE_NAMES[venue]} size={16} /> }))}
    />
  );
}

function Summary({ plans }: { plans: LegPlan[] }) {
  const notional = plans.reduce((sum, plan) => sum + (plan.market ? plan.size * (plan.market.midPx ?? plan.market.markPx ?? 0) : 0), 0);
  const fees = plans.reduce((sum, plan) => sum + (plan.market ? plan.size * (plan.market.midPx ?? plan.market.markPx ?? 0) * takerFeeFor(plan.market) : 0), 0);
  const margin = plans.reduce((sum, plan) => sum + (plan.market ? (plan.size * (plan.market.midPx ?? plan.market.markPx ?? 0)) / plan.leverage : 0), 0);
  return (
    <div className="grid grid-cols-3 gap-2 rounded-lg bg-app-chip/50 px-2.5 py-2 text-[12px] tabular-nums">
      <div>
        <p className="text-app-muted">Volume</p>
        <p className="text-app-ink">{formatPrice(notional)}</p>
      </div>
      <div>
        <p className="text-app-muted">Margin</p>
        <p className="text-app-ink">{formatPrice(margin)}</p>
      </div>
      <div>
        <p className="text-app-muted">Est. taker fees</p>
        <p className="text-app-ink">{formatPrice(fees)}</p>
      </div>
    </div>
  );
}

/**
 * Pro order: market orders on any perp venue and coin in one go. Hedge opens the same coin long on one venue and short
 * on another at the same size (delta neutral: volume and points without price exposure); multi sends up to
 * MAX_PRO_LEGS independent orders. Every leg is a market order with the venue's usual slippage cap; legs are sent
 * together and a partial result is reported so the user can fix the rest.
 */
export function ProOrderDialog() {
  const { isProOrderOpen, closeProOrder, marketsByVenue, perpOrder, placeOrder, isVenueReady, openSetup } = useTrading();
  const { symbol: chartSymbol } = useSelectedAsset();
  const { preferences } = usePreferences();
  const { address } = useWallet();
  const { open: openWallets } = useWalletModal();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("hedge");
  const [armed, setArmed] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);

  const marketFor = (venue: PerpVenueId, symbol: string): VenueMarket | null => {
    const list = marketsByVenue[venue];
    return list ? findMarket(list, symbol) : null;
  };
  const venues = perpOrder;
  const symbols = useMemo(() => {
    const all = new Set<string>();
    for (const venue of perpOrder) for (const market of marketsByVenue[venue] ?? []) all.add(market.symbol);
    return [...all].sort();
  }, [marketsByVenue, perpOrder]);

  // Hedge
  const [hedgeSymbol, setHedgeSymbol] = useState(chartSymbol);
  const listing = venues.filter((venue) => marketFor(venue, hedgeSymbol));
  const [longVenue, setLongVenue] = useState<PerpVenueId>("hyperliquid");
  const [shortVenue, setShortVenue] = useState<PerpVenueId>("lighter");
  const [hedgeUsd, setHedgeUsd] = useState("100");
  const [hedgeLeverage, setHedgeLeverage] = useState(3);

  // Multi
  const [legs, setLegs] = useState<ProLeg[]>(() => [{ id: 1, venue: perpOrder[0] ?? "hyperliquid", symbol: chartSymbol, side: "buy", usd: 50, leverage: 3 }]);
  const updateLeg = (id: number, patch: Partial<ProLeg>) => setLegs((current) => current.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)));
  const addLeg = () =>
    setLegs((current) =>
      current.length >= MAX_PRO_LEGS ? current : [...current, { ...current[current.length - 1], id: Math.max(...current.map((leg) => leg.id)) + 1 }],
    );

  // Opening on a coin starts from the chart's; a hedge needs two different venues that list it.
  useEffect(() => {
    if (isProOrderOpen) setHedgeSymbol(chartSymbol);
  }, [isProOrderOpen, chartSymbol]);
  useEffect(() => {
    if (listing.length < 2) return;
    if (!listing.includes(longVenue)) setLongVenue(listing[0]);
    if (!listing.includes(shortVenue) || shortVenue === longVenue) setShortVenue(listing.find((venue) => venue !== (listing.includes(longVenue) ? longVenue : listing[0]))!);
    // listing is rebuilt every render; its contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.join(","), longVenue, shortVenue]);

  const hedgeMarkets = [marketFor(longVenue, hedgeSymbol), marketFor(shortVenue, hedgeSymbol)];
  const sharedDecimals = hedgeMarkets.every(Boolean) ? Math.min(...hedgeMarkets.map((market) => market!.szDecimals)) : undefined;
  const plans =
    mode === "hedge"
      ? planLegs(hedgeLegs(hedgeSymbol, longVenue, shortVenue, Number(hedgeUsd), hedgeLeverage), marketFor, minOrderUsd, sharedDecimals)
      : planLegs(legs, marketFor, minOrderUsd);
  const hedgeProblem = mode === "hedge" && (listing.length < 2 ? `${hedgeSymbol} needs to be listed on two perp venues` : longVenue === shortVenue ? "Pick two different venues" : null);
  const problem = hedgeProblem || plans.find((plan) => plan.problem)?.problem || null;
  const notReady = [...new Set(plans.map((plan) => plan.leg.venue))].find((venue) => !isVenueReady(venue));
  const hedgeMaxLeverage = Math.max(1, Math.min(...hedgeMarkets.map((market) => market?.maxLeverage ?? 1)));

  useEffect(() => setArmed(false), [mode, hedgeSymbol, longVenue, shortVenue, hedgeUsd, hedgeLeverage, legs]);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const backdropRef = useModalEnter(isProOrderOpen);

  if (!isProOrderOpen) return null;

  const submit = async () => {
    if (!address) return openWallets();
    if (notReady) return openSetup(notReady);
    if (problem || isPlacing) return;
    if (!armed) return setArmed(true);
    setArmed(false);
    setIsPlacing(true);
    const results = await Promise.all(
      plans.map((plan) =>
        placeOrder({ market: plan.market!, side: plan.leg.side, kind: "market", size: plan.size, leverage: plan.leverage, isCross: !plan.market!.onlyIsolated }),
      ),
    );
    setIsPlacing(false);
    plans.forEach((plan, index) => {
      const result = results[index];
      if (result) trackPerpOrder(result, { venue: plan.leg.venue, side: plan.leg.side, newsId: null, oneClick: preferences.oneClickTrading });
    });
    const placed = results.filter(Boolean).length;
    if (placed === plans.length) {
      toast({
        tone: "success",
        title: mode === "hedge" ? `${hedgeSymbol} hedge open` : `${placed} orders placed`,
        message:
          mode === "hedge"
            ? `Long ${PERP_VENUE_NAMES[longVenue]}, short ${PERP_VENUE_NAMES[shortVenue]}, ${plans[0].size} ${hedgeSymbol} each.`
            : plans.map((plan) => `${plan.leg.side === "buy" ? "Long" : "Short"} ${plan.size} ${plan.leg.symbol} on ${PERP_VENUE_NAMES[plan.leg.venue]}`).join(" · "),
      });
      closeProOrder();
    } else if (placed > 0) {
      toast({
        tone: "error",
        title: `${placed} of ${plans.length} orders placed`,
        message:
          mode === "hedge"
            ? "Only one leg of the hedge opened: close it from Positions or retry the other leg."
            : "Check Positions for what went through; each failed order has its own message.",
      });
    }
  };

  const buttonText = !address
    ? "Connect wallet"
    : notReady
      ? `Set up ${PERP_VENUE_NAMES[notReady]} first`
      : isPlacing
        ? "Placing…"
        : armed
          ? `Confirm ${plans.length} order${plans.length === 1 ? "" : "s"}`
          : mode === "hedge"
            ? `Open hedge: long ${PERP_VENUE_NAMES[longVenue]} + short ${PERP_VENUE_NAMES[shortVenue]}`
            : `Place ${plans.length} market order${plans.length === 1 ? "" : "s"}`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" ref={backdropRef} role="presentation" onClick={closeProOrder}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-order-title"
        onClick={(event) => event.stopPropagation()}
        className="surface-menu scrollbar-subtle flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col gap-3 overflow-x-hidden overflow-y-auto rounded-2xl border border-app-hairline-strong bg-app-card p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
      >
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="pro-order-title" className="flex items-center gap-2 text-[16px] font-semibold text-app-ink">
              Pro order
              <span className="rounded-sm px-1.5 py-[2px] text-[10px] font-bold uppercase tracking-[0.08em] text-app-on-accent" style={{ background: PRO }}>
                Pro
              </span>
            </h2>
            <p className="mt-1 text-[12px] text-app-muted">
              Market orders on any venue and coin, sent together. Hedge for delta-neutral volume and points; multi for several orders at once.
            </p>
          </div>
          <button type="button" onClick={closeProOrder} aria-label="Close" className="text-app-faint hover:text-app-ink">
            <X className="size-4" />
          </button>
        </header>

        <Tabs
          label="Pro order type"
          value={mode}
          onChange={setMode}
          options={[
            { value: "hedge", label: "Hedge" },
            { value: "multi", label: "Multi order" },
          ]}
        />

        {mode === "hedge" ? (
          <div className="flex flex-col gap-2.5">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
              <label className="flex min-w-0 flex-col gap-1 text-[11px] text-app-muted">
                Coin
                <CoinPicker symbols={symbols} value={hedgeSymbol} onChange={setHedgeSymbol} />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-[11px] text-app-muted">
                Size per leg (USD)
                <input className={field} inputMode="decimal" value={hedgeUsd} onChange={(event) => setHedgeUsd(event.target.value.replace(/[^0-9.]/g, ""))} />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-[11px] text-app-up">
                Long on
                <VenueSelect label="Long venue" venues={listing.length ? listing : venues} value={longVenue} onChange={setLongVenue} />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-[11px] text-app-down">
                Short on
                <VenueSelect label="Short venue" venues={listing.length ? listing : venues} value={shortVenue} onChange={setShortVenue} />
              </label>
            </div>
            <label className="flex min-w-0 flex-col gap-1 text-[11px] text-app-muted">
              <span className="flex items-center justify-between">
                Leverage on each venue
                <span className="font-semibold tabular-nums text-app-ink">{Math.min(hedgeLeverage, hedgeMaxLeverage)}x</span>
              </span>
              <RangeSlider
                label="Leverage on each venue"
                min={1}
                max={hedgeMaxLeverage}
                value={Math.min(hedgeLeverage, hedgeMaxLeverage)}
                onChange={setHedgeLeverage}
              />
            </label>
            <p className="text-[11px] text-app-faint">
              Same size on both legs ({plans[0]?.size || "—"} {hedgeSymbol}), so price moves cancel out. Watch margin and funding on each venue; close
              both legs together from Positions.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {legs.map((leg, index) => {
              const plan = plans[index];
              return (
                <div key={leg.id} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] gap-2 rounded-xl border border-app-hairline p-2">
                  <VenueSelect label="Venue" venues={venues} value={leg.venue} onChange={(venue) => updateLeg(leg.id, { venue })} />
                  <CoinPicker symbols={symbols} value={leg.symbol} onChange={(symbol) => updateLeg(leg.id, { symbol })} />
                  <button
                    type="button"
                    onClick={() => setLegs((current) => current.filter((entry) => entry.id !== leg.id))}
                    disabled={legs.length === 1}
                    aria-label="Remove order"
                    className="grid size-9 place-items-center rounded-lg text-app-faint hover:bg-app-chip hover:text-app-ink disabled:opacity-30"
                  >
                    <Trash2 className="size-4" />
                  </button>
                  <div className="col-span-full grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,5.5rem)] gap-2">
                  <div role="group" aria-label="Side" className="flex gap-0.5 rounded-lg bg-app-chip p-0.5">
                    {(["buy", "sell"] as OrderSide[]).map((side) => (
                      <button
                        key={side}
                        type="button"
                        aria-pressed={leg.side === side}
                        onClick={() => updateLeg(leg.id, { side })}
                        className={`h-8 flex-1 rounded-md text-[12px] font-semibold ${
                          leg.side === side ? (side === "buy" ? "bg-app-up/20 text-app-up" : "bg-app-down/20 text-app-down") : "text-app-muted"
                        }`}
                      >
                        {side === "buy" ? "Long" : "Short"}
                      </button>
                    ))}
                  </div>
                  <input
                    aria-label="Size in USD"
                    className={field}
                    inputMode="decimal"
                    placeholder="USD"
                    value={leg.usd || ""}
                    onChange={(event) => updateLeg(leg.id, { usd: Number(event.target.value.replace(/[^0-9.]/g, "")) || 0 })}
                  />
                  <label className="flex min-w-0 items-center gap-1 text-[12px] text-app-muted">
                    <input
                      aria-label="Leverage"
                      className={`${field} px-2`}
                      inputMode="numeric"
                      value={leg.leverage}
                      onChange={(event) => updateLeg(leg.id, { leverage: Number(event.target.value.replace(/[^0-9]/g, "")) || 1 })}
                    />
                    x
                  </label>
                  </div>
                  {plan?.problem && <p className="col-span-full text-[11px] text-app-down">{plan.problem}</p>}
                </div>
              );
            })}
            <button
              type="button"
              onClick={addLeg}
              disabled={legs.length >= MAX_PRO_LEGS}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-app-hairline-strong text-[12px] font-semibold text-app-muted hover:text-app-ink disabled:opacity-40"
            >
              <Plus className="size-3.5" /> Add order ({legs.length}/{MAX_PRO_LEGS})
            </button>
          </div>
        )}

        <Summary plans={plans.filter((plan) => !plan.problem)} />
        {problem && address && !notReady && <p className="text-[11px] text-app-down">{problem}</p>}
        <p className="text-[11px] text-app-faint">Market orders fill at the best available price within each venue&apos;s slippage cap (Hyperliquid 5%, Lighter 3%).</p>
        <button
          type="button"
          disabled={isPlacing || (Boolean(address) && !notReady && Boolean(problem))}
          onClick={() => void submit()}
          className={`h-10 rounded-lg text-[13px] font-semibold text-app-on-accent transition-opacity hover:opacity-90 disabled:opacity-50 ${armed ? "ring-2 ring-app-ink" : ""}`}
          style={{ background: PRO }}
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
}
