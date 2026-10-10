"use client";

import { ArrowLeftRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { useTrading } from "@/components/terminal/trading-provider";
import { minOrderUsd, takerFeeFor } from "@/components/terminal/use-best-execution";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { useWallet } from "@/components/terminal/wallet-provider";
import { trackPerpOrder } from "@/lib/analytics/client";
import { formatPrice } from "@/lib/format";
import { arbBetween, arbLegSize, dailyArbFunding, fundingApr, type FundingArb, type FundingVenue } from "@/lib/trading/funding";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId, VenueMarket } from "@/lib/venues/types";
import { useModalEnter } from "@/components/app/use-motion";
import { RangeSlider } from "@/components/app/range-slider";
import { SelectField } from "@/components/app/select-field";
import { VenueLogo } from "@/components/terminal/venue-logo";

const ARM_MS = 5_000;

const inputClass =
  "h-9 w-full rounded-lg border border-app-field-border bg-app-field px-2.5 text-[13px] tabular-nums text-app-ink outline-hidden focus:border-app-ink";

/**
 * Opens a delta-neutral funding position in one go: a market long on one venue and a market short on another, same size
 * on both. It opens on the best pair (long the lowest funding, short the highest); either leg's venue can be changed,
 * for volume elsewhere or where the money already is, and the spread follows (negative = the pair pays funding). Both
 * legs are sent together; if only one fills, the user is told to close it.
 */
export function FundingArbDialog({
  symbol,
  arb: best,
  rates,
  venues,
  markets,
  onClose,
}: {
  symbol: string;
  /** The best pair, the starting point. */
  arb: FundingArb;
  /** Funding per venue (8-hour rates). */
  rates: Partial<Record<FundingVenue, number>>;
  /** Tradable venues that list the asset and have a funding rate: what each leg can pick. */
  venues: FundingVenue[];
  /** The asset's markets per venue; every one of `venues` must be among them. */
  markets: Partial<Record<PerpVenueId, VenueMarket>>;
  onClose: () => void;
}) {
  const toast = useToast();
  const { preferences } = usePreferences();
  const { address } = useWallet();
  const { open: openWallets } = useWalletModal();
  const { placeOrder, isVenueReady, openSetup, accounts } = useTrading();
  const [longPick, setLongPick] = useState<FundingVenue>(best.longVenue);
  const [shortPick, setShortPick] = useState<FundingVenue>(best.shortVenue);
  const arb = arbBetween(rates, longPick, shortPick) ?? best;
  const longVenue = arb.longVenue as PerpVenueId;
  const shortVenue = arb.shortVenue as PerpVenueId;
  const isBest = arb.longVenue === best.longVenue && arb.shortVenue === best.shortVenue;
  const venueOptions = (exclude: FundingVenue) =>
    venues
      .filter((venue) => venue !== exclude)
      .map((venue) => {
        const rate = rates[venue];
        const free = accounts[venue as PerpVenueId]?.withdrawable;
        const apr = rate === undefined ? "" : ` · ${fundingApr(rate) >= 0 ? "+" : ""}${fundingApr(rate).toFixed(2)}%`;
        return {
          value: venue,
          label: `${PERP_VENUE_NAMES[venue as PerpVenueId]}${apr}${free !== undefined ? ` · ${formatPrice(free)} free` : ""}`,
          icon: <VenueLogo name={PERP_VENUE_NAMES[venue as PerpVenueId]} size={16} />,
        };
      });
  const long = markets[longVenue]!;
  const short = markets[shortVenue]!;
  const maxLeverage = Math.min(long.maxLeverage, short.maxLeverage);
  const [size, setSize] = useState("100");
  const [leverage, setLeverage] = useState(Math.min(3, maxLeverage));
  const [armed, setArmed] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);

  const notional = Number(size);
  const price = long.midPx ?? long.markPx ?? short.midPx ?? short.markPx ?? 0;
  const base = arbLegSize(notional, price, [long.szDecimals, short.szDecimals]);
  // Each leg must clear its venue's minimum order (Lighter's from the market, Aster's and Orderly's in dollars).
  const strictest = [long, short].map((market) => ({ market, usd: minOrderUsd(market) })).sort((a, b) => b.usd - a.usd)[0];
  const tooSmall = base <= 0 || base * price < strictest.usd;
  const openingFees = notional * (takerFeeFor(long) + takerFeeFor(short));
  const notReady = [longVenue, shortVenue].find((venue) => !isVenueReady(venue));

  useEffect(() => setArmed(false), [size, leverage, longPick, shortPick]);
  const backdropRef = useModalEnter(true);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const submit = async () => {
    if (!address) return openWallets();
    if (notReady) return openSetup(notReady);
    if (tooSmall || isPlacing) return;
    if (!armed) return setArmed(true);
    setArmed(false);
    setIsPlacing(true);
    const legs = [
      { market: long, side: "buy" as const },
      { market: short, side: "sell" as const },
    ];
    const results = await Promise.all(
      legs.map((leg) => placeOrder({ market: leg.market, side: leg.side, kind: "market", size: base, leverage, isCross: !leg.market.onlyIsolated })),
    );
    setIsPlacing(false);
    legs.forEach((leg, index) => {
      const result = results[index];
      if (result) trackPerpOrder(result, { venue: leg.market.venue, side: leg.side, newsId: null, oneClick: preferences.oneClickTrading });
    });
    if (results.every(Boolean)) {
      toast({ tone: "success", title: `${symbol} funding position open`, message: `Long ${PERP_VENUE_NAMES[longVenue]}, short ${PERP_VENUE_NAMES[shortVenue]}, ${base} ${symbol} each.` });
      onClose();
    } else if (results.some(Boolean)) {
      const filled = legs[results.findIndex(Boolean)];
      toast({
        tone: "error",
        title: "Only one leg opened",
        message: `The ${filled.side === "buy" ? "long" : "short"} on ${PERP_VENUE_NAMES[filled.market.venue]} is open without its hedge. Close it from Positions or retry the other leg.`,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" ref={backdropRef} role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="funding-arb-title"
        onClick={(event) => event.stopPropagation()}
        className="surface-menu scrollbar-subtle max-h-[calc(100dvh-2rem)] overflow-y-auto flex w-full max-w-md flex-col gap-3 rounded-2xl border border-app-hairline-strong bg-app-card p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
      >
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="funding-arb-title" className="text-[16px] font-semibold text-app-ink">
              {symbol} funding position
            </h2>
            <p className="mt-1 text-[12px] text-app-muted">
              A long on one venue and a short on another: price moves cancel out and you collect the funding difference (mainnet
              rates; it can change or flip). It starts on the best pair; pick other venues if you&apos;d rather trade where your money is.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-app-faint hover:text-app-ink">
            <X className="size-4" />
          </button>
        </header>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
          <label className="flex min-w-0 flex-col gap-1 text-[11px] text-app-up">
            Long on
            <SelectField<FundingVenue> size="sm" rootClassName="w-full" className="w-full" label="Long venue" value={longPick} options={venueOptions(shortPick)} onChange={setLongPick} />
          </label>
          <button
            type="button"
            aria-label="Swap long and short"
            title="Swap long and short"
            onClick={() => {
              setLongPick(shortPick);
              setShortPick(longPick);
            }}
            className="grid size-9 place-items-center rounded-lg text-app-muted hover:bg-app-chip hover:text-app-ink"
          >
            <ArrowLeftRight className="size-4" aria-hidden />
          </button>
          <label className="flex min-w-0 flex-col gap-1 text-[11px] text-app-down">
            Short on
            <SelectField<FundingVenue> size="sm" rootClassName="w-full" className="w-full" label="Short venue" value={shortPick} options={venueOptions(longPick)} onChange={setShortPick} />
          </label>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-app-chip/50 px-2.5 py-2 text-[12px] tabular-nums">
          <span className="text-app-muted">Funding spread</span>
          <span className="flex items-center gap-2">
            <span className={`font-semibold ${arb.apr >= 0 ? "text-app-up" : "text-app-down"}`}>
              {arb.apr >= 0 ? "+" : ""}
              {arb.apr.toFixed(2)}% APR
            </span>
            {isBest ? (
              <span className="rounded bg-app-up/15 px-1.5 text-[10px] font-semibold uppercase text-app-up">Best</span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setLongPick(best.longVenue);
                  setShortPick(best.shortVenue);
                }}
                className="text-[11px] font-semibold text-app-accent hover:underline"
              >
                Best: {best.apr.toFixed(2)}%
              </button>
            )}
          </span>
        </div>
        {arb.apr < 0 && (
          <p className="text-[11px] text-[#f5c97b]">This pair pays funding instead of collecting it: swap the legs or pick other venues to earn it.</p>
        )}
        <label className="flex flex-col gap-1 text-[11px] text-app-muted">
          Size per leg (USD)
          <input className={inputClass} inputMode="decimal" value={size} onChange={(event) => setSize(event.target.value.replace(/[^0-9.]/g, ""))} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-app-muted">
          <span className="flex items-center justify-between">
            Leverage on each venue
            <span className="font-semibold tabular-nums text-app-ink">{leverage}x</span>
          </span>
          <RangeSlider label="Leverage on each venue" min={1} max={maxLeverage} value={leverage} onChange={setLeverage} />
        </label>
        <div className="flex flex-col gap-1 rounded-lg bg-app-chip/50 px-2.5 py-2 text-[12px] tabular-nums">
          <Row label="Each leg">
            {base > 0 ? `${base} ${symbol}` : "—"} · margin {formatPrice(notional / leverage)}
          </Row>
          <Row label={dailyArbFunding(notional, arb) >= 0 ? "Est. funding per day" : "Est. funding cost per day"}>{formatPrice(Math.abs(dailyArbFunding(notional, arb)))}</Row>
          <Row label="Opening fees (both legs)">{formatPrice(openingFees)}</Row>
          <Row label="Break-even (open + close fees)">
            {dailyArbFunding(notional, arb) > 0 ? `${Math.ceil((openingFees * 2) / dailyArbFunding(notional, arb))} days` : "—"}
          </Row>
        </div>
        {tooSmall && notional > 0 && (
          <p className="text-[11px] text-app-down">
            Too small{strictest.usd > 0 ? `: ${PERP_VENUE_NAMES[strictest.market.venue]}'s ${symbol} minimum is about $${Math.ceil(strictest.usd)} per leg` : ""}.
          </p>
        )}
        <p className="text-[11px] text-app-faint">Both legs are separate positions: watch margin on each venue.</p>
        <button
          type="button"
          disabled={isPlacing || (Boolean(address) && !notReady && tooSmall)}
          onClick={() => void submit()}
          className={`h-10 rounded-lg bg-app-accent text-[13px] font-semibold text-app-on-accent transition-colors disabled:opacity-50 ${armed ? "ring-2 ring-app-ink" : ""}`}
        >
          {!address
            ? "Connect wallet"
            : notReady
              ? `Set up ${PERP_VENUE_NAMES[notReady]} first`
              : isPlacing
                ? "Opening both legs…"
                : armed
                  ? "Confirm both legs"
                  : `Open long ${PERP_VENUE_NAMES[longVenue]} + short ${PERP_VENUE_NAMES[shortVenue]}`}
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-app-muted">{label}</span>
      <span className="text-app-ink">{children}</span>
    </div>
  );
}
