"use client";

import { useSpotHoldings } from "@/components/portfolio/use-spot-holdings";
import { SpotTable, STABLECOINS } from "@/components/portfolio/spot-table";
import { assetSymbolOf, normalizeSpotSymbol } from "@/lib/spot/listings";
import { holdingsValue, type SpotHolding } from "@/lib/venues/jupiter/holdings";
import { useSelectedAsset } from "./selected-asset";
import { useWalletModal } from "./wallet-modal";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The panel under the chart on /swap: the Solana wallet's tokens (what a swap changes), not perp positions. A row
 * picks that token for the swap card and the chart; dollar tokens stay put (they are the other side of every swap).
 */
export function SwapHoldings() {
  const { address, loading, data, failed } = useSpotHoldings();
  const { open: openWallets } = useWalletModal();
  const { selectAsset } = useSelectedAsset();
  const holdings = data?.holdings ?? [];
  const total = holdingsValue(holdings);

  const pick = (holding: SpotHolding) => {
    if (STABLECOINS.has(holding.symbol.toUpperCase())) return;
    const asset = assetSymbolOf({ symbol: holding.symbol, name: holding.name, category: "crypto" }) ?? normalizeSpotSymbol(holding.symbol);
    selectAsset(asset, holding.mint);
  };

  return (
    <section aria-label="Holdings" className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55">
      <div className="flex shrink-0 items-center gap-4 border-b border-app-hairline px-3">
        <span className="-mb-px flex h-9 items-center gap-1.5 border-b-2 border-app-accent text-[12px] font-semibold text-app-ink">
          Holdings <span className="tabular-nums text-app-faint">{holdings.length}</span>
        </span>
        {address && holdings.length > 0 && (
          <span className="ml-auto text-[12px] text-app-muted">
            Total <span className="font-semibold tabular-nums text-app-ink">{usd.format(total)}</span>
            {data && data.hidden > 0 && <span className="text-app-faint"> · {data.hidden} unpriced hidden</span>}
          </span>
        )}
      </div>
      <div className="scrollbar-subtle min-h-0 flex-1 overflow-auto">
        {!address ? (
          <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 px-3 py-4 text-center text-[12px] text-app-muted">
            Connect a Solana wallet to see your tokens.
            <button type="button" onClick={openWallets} className="h-7 rounded-lg bg-app-chip px-3 font-semibold text-app-ink hover:bg-app-selected">
              Connect wallet
            </button>
          </div>
        ) : loading && !data ? (
          <p className="px-3 py-6 text-center text-[12px] text-app-muted">Loading tokens…</p>
        ) : failed && !data ? (
          <p className="px-3 py-6 text-center text-[12px] text-app-muted">Couldn&apos;t load the wallet&apos;s tokens. Retrying…</p>
        ) : (
          <SpotTable holdings={holdings} total={total} onSelect={pick} />
        )}
      </div>
    </section>
  );
}
