"use client";

import { useEffect, useState } from "react";
import { formatPrice } from "@/lib/format";
import { formatUsdCompact, fundingCountdown, hourlyFundingPct, signedPercent } from "@/lib/trading/market-stats";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { VenueMarket } from "@/lib/venues/types";
import { useFunding } from "./use-funding";

function useNow(intervalMs: number) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function Stat({ label, title, children }: { label: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col justify-center gap-0.5 border-l border-app-hairline pl-3 first:border-l-0 first:pl-0" title={title}>
      <span className="text-[10px] leading-none text-app-faint">{label}</span>
      <span className="text-[12px] font-medium leading-none tabular-nums text-app-ink">{children}</span>
    </div>
  );
}

/** Mark, 24h volume, open interest and hourly funding with its countdown for the chart's perp market. */
export function MarketStats({
  market,
  contentRef,
  className = "",
}: {
  /** undefined while the venue market lists load. */
  market: VenueMarket | null | undefined;
  contentRef?: React.Ref<HTMLDivElement>;
  className?: string;
}) {
  const funding = useFunding();
  const now = useNow(1000);
  // Phones show the stats on their own row: keep it while loading so the chart doesn't move down afterwards.
  if (market === undefined) return <div aria-hidden className={`h-6 lg:hidden ${className}`} />;
  if (!market) return null;
  const rate8h = funding?.[market.symbol]?.[market.venue];
  return (
    <div className={`scrollbar-none flex min-w-0 flex-1 overflow-x-auto pr-4 mask-[linear-gradient(90deg,#000_calc(100%-24px),transparent)] ${className}`}>
      {/* Sized to its content so the chart header can measure what the stats need. */}
      <div ref={contentRef} className="flex w-max items-center gap-3">
      <Stat label="Mark" title={`${PERP_VENUE_NAMES[market.venue]} mark price`}>
        {market.markPx ? formatPrice(market.markPx) : "—"}
      </Stat>
      <Stat label="24h volume">{formatUsdCompact(market.volume24hUsd)}</Stat>
      <Stat label="Open interest">{formatUsdCompact(market.openInterestUsd)}</Stat>
      <Stat label="Funding (1h) / next" title="Mainnet funding, paid every hour. Positive: longs pay shorts.">
        <span className={rate8h === undefined ? "" : rate8h >= 0 ? "text-app-up" : "text-app-down"}>
          {rate8h === undefined ? "—" : signedPercent(hourlyFundingPct(rate8h), 4)}
        </span>
        <span className="text-app-muted"> / {now === null ? "--:--" : fundingCountdown(now)}</span>
      </Stat>
      </div>
    </div>
  );
}
