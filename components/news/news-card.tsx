"use client";

import { Bell, Newspaper } from "lucide-react";
import { MarketIcon } from "@/components/app/market-icon";
import { formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import type { Direction, NewsItem } from "@/lib/types";
import { MarketReactionButton } from "./market-reaction-button";
import { ScoreBadge } from "./score-badge";
import { SeverityBadge } from "./severity-badge";
import { SourceLabel } from "./source-label";
import { SymbolChip } from "./symbol-chip";

const MAX_CHIPS = 4;

interface NewsCardProps {
  item: NewsItem;
  /** Rendered right after the lead asset chip (trade buttons). */
  renderLeadActions?: (lead: { symbol: string; direction: Direction; mint?: string }) => React.ReactNode;
  isSelected?: boolean;
  /** Briefly highlights a high-impact arrival. */
  isFlashing?: boolean;
  onSelect?: () => void;
  /** Clicking an asset chip selects that asset in the chart. */
  onSelectAsset?: (symbol: string, mint?: string) => void;
  selectedSymbol?: string;
}

function chipsFor(item: NewsItem): { symbol: string; direction: Direction }[] {
  const coins = item.coins?.length ? item.coins : [];
  return coins.slice(0, MAX_CHIPS).map((symbol) => {
    const prediction = item.predictions?.find((entry) => entry.symbol === symbol);
    return { symbol, direction: prediction ? (prediction.direction === "+" ? "up" : "down") : item.direction };
  });
}

export function NewsCard({ item, onSelectAsset, selectedSymbol, renderLeadActions, isSelected, isFlashing, onSelect }: NewsCardProps) {
  const t = useT();
  const chips = chipsFor(item);
  const hasAsset = chips.length > 0;

  return (
    <article
      onClick={onSelect}
      aria-current={isSelected || undefined}
      className={`-mx-3 flex gap-3 border-b border-l-2 border-b-app-hairline px-3 py-[var(--news-padding)] transition-colors duration-700 last:border-b-0 ${
        isSelected ? "border-l-app-accent bg-app-chip/40" : "border-l-transparent"
      } ${isFlashing ? "news-flash" : ""}`}
    >
      {hasAsset ? (
        <MarketIcon symbol={item.symbol} size={32} />
      ) : (
        <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-app-chip text-app-muted">
          <Newspaper className="size-4" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {item.enriched ? (
            <SeverityBadge severity={item.severity} />
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded bg-app-chip px-1.5 py-[3px] text-[10px] font-semibold uppercase leading-none tracking-[0.08em] text-app-muted">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-app-accent" />
              Raw
            </span>
          )}
          {item.alerted && (
            <span className="inline-flex size-[18px] items-center justify-center rounded bg-[#fbefd6] text-[#c27c12]">
              <Bell className="size-3" aria-label={t("news.alertSet")} />
            </span>
          )}
          <time
            dateTime={item.publishedAt ? new Date(item.publishedAt).toISOString() : undefined}
            className="ml-auto text-[12px] tabular-nums text-app-muted"
          >
            {formatRelativeTime(item.minutesAgo, t)}
          </time>
        </div>

        <h3 className="mt-1.5 text-[14px] font-semibold leading-snug text-app-ink">
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {item.headline}
            </a>
          ) : (
            item.headline
          )}
        </h3>

        {item.summary && <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-app-muted">{item.summary}</p>}

        <div className="mt-2 flex items-center gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {chips.map((chip, index) => (
              <span key={chip.symbol} className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect?.();
                  onSelectAsset?.(chip.symbol, item.mints?.[chip.symbol]);
                }}
                aria-pressed={selectedSymbol === chip.symbol}
                title={`Show ${chip.symbol} on the chart`}
                className={`rounded-md px-1 py-0.5 transition-colors hover:bg-app-chip ${
                  selectedSymbol === chip.symbol ? "bg-app-chip ring-1 ring-app-hairline-strong" : ""
                }`}
              >
                <SymbolChip symbol={chip.symbol} direction={chip.direction} />
              </button>
              {index === 0 && renderLeadActions?.({ symbol: chip.symbol, direction: chip.direction, mint: item.mints?.[chip.symbol] })}
              </span>
            ))}
          </div>
          {item.enriched && <ScoreBadge score={item.score} />}
          <div className="ml-auto min-w-0">
            <SourceLabel sources={item.sources} />
          </div>
        </div>

        {item.marketReaction && (
          <div className="mt-3">
            <MarketReactionButton />
          </div>
        )}
      </div>
    </article>
  );
}
