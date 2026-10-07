"use client";

import { useState } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { formatPrice } from "@/lib/format";
import type { SpotHolding } from "@/lib/venues/jupiter/holdings";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const th = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-app-faint whitespace-nowrap";
const td = "px-3 py-2 tabular-nums whitespace-nowrap text-app-ink";

export const STABLECOINS = new Set(["USDC", "USDT", "USDG", "PYUSD", "USDS", "USD1", "FDUSD"]);

function TokenIcon({ holding }: { holding: SpotHolding }) {
  const [broken, setBroken] = useState(false);
  if (!holding.icon || broken) return <MarketIcon symbol={holding.symbol.toUpperCase()} kind="crypto" size={20} />;
  // Token logos come from many hosts (Jupiter's list), so a plain img rather than next/image.
  return <img src={holding.icon} alt="" width={20} height={20} loading="lazy" onError={() => setBroken(true)} className="size-5 shrink-0 rounded-full object-cover" />;
}

/** Balances worth less than this sit behind "Show small balances". */
const DUST_USD = 1;

/**
 * A Solana wallet's tokens: amount, price, value and share of the total, small balances folded away. With `onSelect`
 * (the swap view) a row picks that token to trade.
 */
export function SpotTable({ holdings, total, onSelect }: { holdings: SpotHolding[]; total: number; onSelect?: (holding: SpotHolding) => void }) {
  const [showDust, setShowDust] = useState(false);
  if (holdings.length === 0) return <p className="px-3 py-6 text-center text-[13px] text-app-muted">No tokens in this wallet.</p>;
  const dust = holdings.filter((holding) => (holding.usd ?? 0) < DUST_USD).length;
  const shown = showDust ? holdings : holdings.filter((holding) => (holding.usd ?? 0) >= DUST_USD);
  return (
    <>
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 bg-app-card">
        <tr>
          <th className={th}>Asset</th>
          <th className={`${th} text-right`}>Amount</th>
          <th className={`${th} text-right`}>Price</th>
          <th className={`${th} text-right`}>Value</th>
          <th className={`${th} w-40`}>Share</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((holding) => {
          const share = total > 0 && holding.usd !== null ? (holding.usd / total) * 100 : 0;
          return (
            <tr
              key={holding.mint}
              onClick={onSelect ? () => onSelect(holding) : undefined}
              title={onSelect ? `Swap ${holding.symbol}` : undefined}
              className={`border-t border-app-hairline ${onSelect ? "cursor-pointer hover:bg-app-chip/50" : ""}`}
            >
              <td className={td}>
                <span className="flex items-center gap-2">
                  <TokenIcon holding={holding} />
                  <span className="font-semibold">{holding.symbol}</span>
                  <span className="max-w-[160px] truncate text-app-faint">{holding.name}</span>
                  {!holding.verified && (
                    <span title="Not verified by Jupiter" className="rounded-sm bg-app-chip px-1 py-[2px] text-[9px] font-semibold uppercase tracking-[0.08em] text-app-muted">
                      Unverified
                    </span>
                  )}
                </span>
              </td>
              <td className={`${td} text-right`}>{holding.amount.toLocaleString("en-US", { maximumSignificantDigits: 6 })}</td>
              <td className={`${td} text-right text-app-muted`}>{holding.usdPrice === null ? "—" : formatPrice(holding.usdPrice)}</td>
              <td className={`${td} text-right`}>{holding.usd === null ? "—" : usd.format(holding.usd)}</td>
              <td className={td}>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-app-chip">
                    <span className="block h-full rounded-full bg-app-accent" style={{ width: `${share}%` }} />
                  </span>
                  <span className="w-12 text-right text-app-muted">{share.toFixed(1)}%</span>
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    {dust > 0 && (
      <button type="button" onClick={() => setShowDust((value) => !value)} className="w-full border-t border-app-hairline py-2 text-[12px] font-semibold text-app-muted hover:text-app-ink">
        {showDust ? "Hide small balances" : `Show ${dust} small balance${dust === 1 ? "" : "s"} (under $${DUST_USD})`}
      </button>
    )}
    </>
  );
}

