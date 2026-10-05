"use client";

import { MarketIcon } from "@/components/app/market-icon";
import { useSelectedAsset } from "./selected-asset";

const field =
  "h-9 w-full rounded-lg border border-app-hairline-strong bg-app-chip px-3 text-[13px] tabular-nums text-app-ink placeholder:text-app-faint disabled:opacity-70";

/** Placeholder until the venue resolver and wallet are wired in. Every control is disabled. */
export function OrderPanel() {
  const { symbol } = useSelectedAsset();

  return (
    <section
      aria-label="Order entry"
      className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-app-hairline px-3 py-2">
        <MarketIcon symbol={symbol} size={20} />
        <h2 className="text-[13px] font-semibold text-app-ink">{symbol}-PERP</h2>
        <span className="ml-auto rounded bg-app-chip px-1.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em] text-app-muted">
          Soon
        </span>
      </header>
      <div className="flex flex-col gap-3 p-3">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-app-chip p-0.5">
          <button type="button" disabled className="h-8 rounded-md bg-app-up/90 text-[13px] font-semibold text-white">
            Long
          </button>
          <button type="button" disabled className="h-8 rounded-md text-[13px] font-semibold text-app-muted">
            Short
          </button>
        </div>
        <div role="group" aria-label="Order type" className="flex gap-3 text-[12px] font-semibold">
          <span className="text-app-ink">Market</span>
          <span className="text-app-faint">Limit</span>
        </div>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-[0.06em] text-app-muted">
          Size (USD)
          <input disabled placeholder="0.00" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-[0.06em] text-app-muted">
          Leverage
          <input disabled placeholder="5x" className={field} />
        </label>
        <dl className="grid grid-cols-2 gap-y-1 text-[12px]">
          <dt className="text-app-muted">Venue</dt>
          <dd className="text-right text-app-ink">Hyperliquid</dd>
          <dt className="text-app-muted">Est. fee</dt>
          <dd className="text-right tabular-nums text-app-ink">—</dd>
        </dl>
        <button
          type="button"
          disabled
          className="h-10 rounded-xl bg-app-accent text-[14px] font-semibold text-app-on-accent opacity-60"
        >
          Connect to trade
        </button>
      </div>
    </section>
  );
}
