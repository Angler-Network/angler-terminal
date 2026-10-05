"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { useTrading } from "@/components/terminal/trading-provider";
import { takerFeeFor } from "@/components/terminal/use-best-execution";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { useWallet } from "@/components/terminal/wallet-provider";
import { trackTrade } from "@/lib/analytics/client";
import { formatPrice } from "@/lib/format";
import { arbLegSize, dailyArbFunding, type FundingArb } from "@/lib/trading/funding";
import { minimumSize } from "@/lib/venues/lighter/pricing";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId, VenueMarket } from "@/lib/venues/types";

const ARM_MS = 5_000;

const inputClass =
  "h-9 w-full rounded-lg border border-app-field-border bg-app-field px-2.5 text-[13px] tabular-nums text-app-ink outline-none focus:border-app-ink";

/**
 * Opens a delta-neutral funding position in one go: a market long on the low-funding venue and a market short on the
 * high-funding one, same size on both. Both legs are sent together; if only one fills, the user is told to close it.
 */
export function FundingArbDialog({
  symbol,
  arb,
  markets,
  onClose,
}: {
  symbol: string;
  arb: FundingArb;
  markets: Record<PerpVenueId, VenueMarket>;
  onClose: () => void;
}) {
  const toast = useToast();
  const { preferences } = usePreferences();
  const { address } = useWallet();
  const { open: openWallets } = useWalletModal();
  const { placeOrder, isVenueReady, openSetup } = useTrading();
  const longVenue = arb.longVenue as PerpVenueId;
  const shortVenue = arb.shortVenue as PerpVenueId;
  const long = markets[longVenue];
  const short = markets[shortVenue];
  const maxLeverage = Math.min(long.maxLeverage, short.maxLeverage);
  const [size, setSize] = useState("100");
  const [leverage, setLeverage] = useState(Math.min(3, maxLeverage));
  const [armed, setArmed] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);

  const notional = Number(size);
  const price = long.midPx ?? long.markPx ?? short.midPx ?? short.markPx ?? 0;
  const base = arbLegSize(notional, price, [long.szDecimals, short.szDecimals]);
  const lighter = long.venue === "lighter" ? long : short.venue === "lighter" ? short : null;
  const lighterMinimum = lighter && price ? minimumSize(lighter, price) : 0;
  const tooSmall = base <= 0 || base < lighterMinimum;
  const openingFees = notional * (takerFeeFor(long) + takerFeeFor(short));
  const notReady = [longVenue, shortVenue].find((venue) => !isVenueReady(venue));

  useEffect(() => setArmed(false), [size, leverage]);
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
      if (results[index]) trackTrade({ venue: leg.market.venue, side: leg.side, newsId: null, oneClick: preferences.oneClickTrading });
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="funding-arb-title"
        onClick={(event) => event.stopPropagation()}
        className="surface-menu flex w-full max-w-md flex-col gap-3 rounded-2xl border border-app-hairline-strong bg-app-card p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
      >
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="funding-arb-title" className="text-[16px] font-semibold text-app-ink">
              {symbol} funding position
            </h2>
            <p className="mt-1 text-[12px] text-app-muted">
              Long on {PERP_VENUE_NAMES[longVenue]}, short on {PERP_VENUE_NAMES[shortVenue]}: price moves cancel out and you collect the funding
              difference (currently {arb.apr.toFixed(2)}% APR, mainnet rates; it can change or flip).
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-app-faint hover:text-app-ink">
            <X className="size-4" />
          </button>
        </header>
        <label className="flex flex-col gap-1 text-[11px] text-app-muted">
          Size per leg (USD)
          <input className={inputClass} inputMode="decimal" value={size} onChange={(event) => setSize(event.target.value.replace(/[^0-9.]/g, ""))} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-app-muted">
          <span className="flex items-center justify-between">
            Leverage on each venue
            <span className="font-semibold tabular-nums text-app-ink">{leverage}x</span>
          </span>
          <input
            type="range"
            min={1}
            max={maxLeverage}
            value={leverage}
            onChange={(event) => setLeverage(Number(event.target.value))}
            className="accent-[rgb(var(--app-accent))]"
          />
        </label>
        <div className="flex flex-col gap-1 rounded-lg bg-app-chip/50 px-2.5 py-2 text-[12px] tabular-nums">
          <Row label="Each leg">
            {base > 0 ? `${base} ${symbol}` : "—"} · margin {formatPrice(notional / leverage)}
          </Row>
          <Row label="Est. funding per day">{formatPrice(dailyArbFunding(notional, arb))}</Row>
          <Row label="Opening fees (both legs)">{formatPrice(openingFees)}</Row>
          <Row label="Break-even (open + close fees)">
            {dailyArbFunding(notional, arb) > 0 ? `${Math.ceil((openingFees * 2) / dailyArbFunding(notional, arb))} days` : "—"}
          </Row>
        </div>
        {tooSmall && notional > 0 && (
          <p className="text-[11px] text-app-down">
            Too small{lighterMinimum ? `: Lighter's ${symbol} minimum is about $${Math.ceil(lighterMinimum * price)} per leg` : ""}.
          </p>
        )}
        <p className="text-[11px] text-app-faint">Not financial advice. Both legs are separate positions: watch margin on each venue.</p>
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
