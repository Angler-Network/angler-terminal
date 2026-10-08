"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useSpotHoldings } from "@/components/portfolio/use-spot-holdings";
import { useTrading } from "@/components/terminal/trading-provider";
import { summarizeVenue, totalSummary } from "@/lib/trading/portfolio";
import { holdingsValue } from "@/lib/venues/jupiter/holdings";
import type { PerpVenueId } from "@/lib/venues/types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** The portfolio at a glance on the profile: total value, perp equity and spot, unrealized PnL; the full view is a tab. */
export function PortfolioCard({ className = "" }: { className?: string }) {
  const { accounts } = useTrading();
  const spot = useSpotHoldings();
  const perp = totalSummary(
    (Object.keys(accounts) as PerpVenueId[]).flatMap((venue) => {
      const snapshot = accounts[venue];
      return snapshot ? [summarizeVenue(venue, snapshot)] : [];
    }),
  );
  const spotValue = holdingsValue(spot.data?.holdings ?? []);
  const pnl = perp.unrealizedPnl;
  const stats = [
    { label: "Perp equity", value: usd.format(perp.accountValue) },
    { label: "Spot", value: spot.loading && !spot.data ? "…" : usd.format(spotValue) },
    { label: "Unrealized PnL", value: `${pnl > 0 ? "+" : ""}${usd.format(pnl)}`, tone: pnl > 0 ? "text-app-up" : pnl < 0 ? "text-app-down" : "text-app-ink" },
    { label: "Open positions", value: String(perp.positions) },
  ];

  return (
    <section className={`${className} flex flex-col p-4`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-app-ink">Portfolio</h2>
        <Link href="/profile/portfolio" className="inline-flex items-center gap-1 text-[12px] font-semibold text-app-muted hover:text-app-ink">
          Open portfolio
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      <p className="mt-1 text-[26px] font-semibold tabular-nums tracking-tight text-app-ink">{usd.format(perp.accountValue + spotValue)}</p>
      <div className="mt-auto grid grid-cols-2 gap-3 pt-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl bg-app-chip/60 px-3 py-2.5">
            <p className="text-[11px] text-app-muted">{stat.label}</p>
            <p className={`mt-0.5 text-[16px] font-semibold tabular-nums ${stat.tone ?? "text-app-ink"}`}>{stat.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
