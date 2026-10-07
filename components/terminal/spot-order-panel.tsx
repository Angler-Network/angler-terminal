"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { TERMINAL_PATHS } from "@/lib/terminal-kind";
import { useAssetSearch } from "./asset-search";
import { BookSpotCard } from "./book-spot-card";
import { useSelectedAsset } from "./selected-asset";
import { useBookSpotRef } from "./use-book-spot";

/**
 * Order entry on /spot: the view's Hyperliquid or Lighter spot market (`useBookSpotRef`). An asset neither venue lists
 * offers the search and its swap instead.
 */
export function SpotOrderPanel() {
  const ref = useBookSpotRef();
  const { symbol } = useSelectedAsset();
  const { open: openSearch } = useAssetSearch();
  return (
    <section aria-label="Order entry" className="flex flex-col gap-2.5 p-3">
      {ref === undefined ? (
        <div role="status" aria-label="Loading market" className="flex h-[300px] flex-col gap-2.5">
          {["h-6", "h-24", "h-24", "h-11"].map((height, index) => (
            <span key={index} aria-hidden className={`${height} shrink-0 animate-pulse rounded-xl bg-app-chip/60`} />
          ))}
        </div>
      ) : ref === null ? (
        <>
          <h3 className="text-[12px] font-semibold text-app-ink">Spot {symbol}</h3>
          <p className="text-[12px] text-app-faint">Hyperliquid and Lighter have no {symbol} spot market.</p>
          <button
            type="button"
            onClick={openSearch}
            className="h-9 rounded-lg bg-app-accent text-[13px] font-semibold text-app-on-accent hover:opacity-90"
          >
            Pick a spot market
          </button>
          <Link
            href={TERMINAL_PATHS.spot}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-app-chip text-[13px] font-semibold text-app-ink transition-colors hover:bg-app-card"
          >
            Swap {symbol}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </>
      ) : (
        <BookSpotCard tokenRef={ref} />
      )}
    </section>
  );
}
