"use client";

import { LoadingState } from "@/components/app/loading-state";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { usePreferences } from "@/components/app/preferences-provider";
import { TERMINAL_PATHS } from "@/lib/terminal-kind";
import { arcusConfig } from "@/lib/venues/arcus/config";
import { ROBINHOOD_SOURCE_NAMES, robinhoodSources } from "@/lib/venues/robinhood-sources";
import { useAssetSearch } from "./asset-search";
import { BookSpotCard } from "./book-spot-card";
import { useSelectedAsset } from "./selected-asset";
import { SwapCard } from "./swap-card";
import { useSpotView } from "./use-book-spot";

/**
 * Order entry on /spot (`useSpotView`): the exchange-style form for a Hyperliquid or Lighter market, or the Arcus card
 * (USDG ↔ stock token, Arcus or Uniswap, "Prefer Arcus") for a Robinhood Chain stock. An asset nothing here lists
 * offers the search and its swap instead.
 */
export function SpotOrderPanel() {
  const view = useSpotView();
  const { symbol } = useSelectedAsset();
  const { preferences } = usePreferences();
  const { open: openSearch } = useAssetSearch();
  return (
    <section aria-label="Order entry" className="flex flex-col gap-2.5 p-3">
      {view === undefined ? (
        <div className="relative flex h-[300px] flex-col gap-2.5">
          {["h-6", "h-24", "h-24", "h-11"].map((height, index) => (
            <span key={index} aria-hidden className={`${height} shrink-0 animate-pulse rounded-xl bg-app-chip/60`} />
          ))}
          <div className="absolute inset-0 grid place-items-center">
            <div className="rounded-xl bg-app-card/90 px-4 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.5)] backdrop-blur-sm">
              <LoadingState label="Loading market…" compact />
            </div>
          </div>
        </div>
      ) : view === null ? (
        <>
          <h3 className="text-[12px] font-semibold text-app-ink">Spot {symbol}</h3>
          <p className="text-[12px] text-app-faint">Hyperliquid, Lighter and Arcus have no {symbol} spot market.</p>
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
      ) : view.mode === "book" ? (
        <BookSpotCard tokenRef={view.ref} />
      ) : (
        <SwapCard
          key={view.token.address}
          choices={[
            {
              id: "arcus",
              name: robinhoodSources(preferences).map((source) => ROBINHOOD_SOURCE_NAMES[source]).join(" · "),
              network: arcusConfig.network,
              kind: "spot",
              arcusToken: view.token,
            },
          ]}
        />
      )}
    </section>
  );
}
