import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatPercent, formatPrice } from "@/lib/format";
import type { Market, Quote } from "@/lib/markets/model";
import { MarketIcon } from "./market-icon";

interface TickerPillProps {
  market: Market;
  quote: Quote;
  upLabel: string;
  downLabel: string;
  /** Terminal addition: clicking the pill opens the pair's chart and news. */
  onSelect?: (symbol: string) => void;
  isActive?: boolean;
  /** False for the duplicated, aria-hidden copies of the tape so they stay out of the tab order. */
  focusable?: boolean;
}

export function TickerPill({ market, quote, upLabel, downLabel, onSelect, isActive, focusable = true }: TickerPillProps) {
  const isUp = quote.changePct >= 0;
  const Arrow = isUp ? ArrowUpRight : ArrowDownRight;
  const content = (
    <>
      <MarketIcon symbol={market.symbol} kind={market.kind} size={18} />
      <span className="text-[13px] font-semibold text-app-ink">{market.symbol}</span>
      <span className="text-[13px] tabular-nums text-app-ink">{formatPrice(quote.price)}</span>
      <span
        className={`inline-flex items-center gap-0.5 text-[13px] font-medium tabular-nums ${
          isUp ? "text-app-up" : "text-app-down"
        }`}
      >
        {formatPercent(quote.changePct)}
        <Arrow className="size-3" aria-label={isUp ? upLabel : downLabel} />
      </span>
    </>
  );

  if (!onSelect) return <li className="flex shrink-0 items-center gap-2 whitespace-nowrap pr-8">{content}</li>;
  return (
    <li className="flex shrink-0 items-center pr-2">
      <button
        type="button"
        tabIndex={focusable ? undefined : -1}
        aria-pressed={isActive}
        title={`Open ${market.symbol} chart and news`}
        onClick={() => onSelect(market.symbol)}
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 transition-colors hover:bg-app-chip ${
          isActive ? "bg-app-chip" : ""
        }`}
      >
        {content}
      </button>
    </li>
  );
}
