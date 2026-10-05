import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatPercent, formatPrice } from "@/lib/format";
import type { Market, Quote } from "@/lib/markets/model";
import { MarketIcon } from "./market-icon";

interface TickerPillProps {
  market: Market;
  quote: Quote;
  upLabel: string;
  downLabel: string;
}

export function TickerPill({ market, quote, upLabel, downLabel }: TickerPillProps) {
  const isUp = quote.changePct >= 0;
  const Arrow = isUp ? ArrowUpRight : ArrowDownRight;

  return (
    <li className="flex shrink-0 items-center gap-2 whitespace-nowrap pr-8">
      <MarketIcon symbol={market.symbol} kind={market.kind} size={24} />
      <span className="text-[15px] font-semibold text-app-ink">{market.symbol}</span>
      <span className="text-[15px] tabular-nums text-app-ink">{formatPrice(quote.price)}</span>
      <span
        className={`inline-flex items-center gap-0.5 text-[15px] font-medium tabular-nums ${
          isUp ? "text-app-up" : "text-app-down"
        }`}
      >
        {formatPercent(quote.changePct)}
        <Arrow className="size-3.5" aria-label={isUp ? upLabel : downLabel} />
      </span>
    </li>
  );
}
