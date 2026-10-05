"use client";

import { Bell, ExternalLink } from "lucide-react";
import { useState } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import type { Direction, NewsItem, Severity } from "@/lib/types";
import { MarketReactionButton } from "./market-reaction-button";
import { SeverityBadge } from "./severity-badge";
import { SymbolChip } from "./symbol-chip";

const MAX_CHIPS = 4;
const NEUTRAL_SENTIMENT = 0.15;

interface NewsCardProps {
  item: NewsItem;
  /** Clicking an asset chip selects that asset in the chart. */
  onSelectAsset?: (symbol: string, mint?: string) => void;
  selectedSymbol?: string;
  /** Rendered right after the lead asset chip (trade buttons). */
  renderLeadActions?: (lead: { symbol: string; direction: Direction; mint?: string }) => React.ReactNode;
  isSelected?: boolean;
  /** Briefly highlights a high-impact arrival. */
  isFlashing?: boolean;
  onSelect?: () => void;
}

const accent: Record<Severity, string> = {
  breaking: "bg-[#ef5350]",
  important: "bg-[#f5a524]",
  notable: "bg-transparent",
};

const meterFill: Record<Severity, string> = {
  breaking: "bg-[#ef5350]",
  important: "bg-[#f5a524]",
  notable: "bg-app-muted",
};

function chipsFor(item: NewsItem): { symbol: string; direction: Direction }[] {
  const coins = item.coins?.length ? item.coins : [];
  return coins.slice(0, MAX_CHIPS).map((symbol) => {
    const prediction = item.predictions?.find((entry) => entry.symbol === symbol);
    return { symbol, direction: prediction ? (prediction.direction === "+" ? "up" : "down") : item.direction };
  });
}

function ImpactMeter({ item }: { item: NewsItem }) {
  if (!item.enriched) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-app-faint" title="Waiting for analysis">
        <span className="h-1.5 w-12 animate-pulse rounded-full bg-app-chip" />
        Analyzing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5" title={`Impact score ${item.score}/100 (model output)`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-app-chip">
        <span className={`block h-full rounded-full ${meterFill[item.severity]}`} style={{ width: `${Math.max(4, item.score)}%` }} />
      </span>
      <span className="text-[12px] font-semibold tabular-nums text-app-ink">{item.score}</span>
    </span>
  );
}

function SentimentPill({ sentiment }: { sentiment: number }) {
  const tone =
    sentiment >= NEUTRAL_SENTIMENT
      ? { label: "Bullish", className: "bg-app-up/10 text-app-up" }
      : sentiment <= -NEUTRAL_SENTIMENT
        ? { label: "Bearish", className: "bg-app-down/10 text-app-down" }
        : { label: "Neutral", className: "bg-app-chip text-app-muted" };
  return (
    <span
      title={`Sentiment ${sentiment.toFixed(2)} (model output)`}
      className={`rounded px-1.5 py-[3px] text-[10px] font-semibold uppercase leading-none tracking-[0.06em] ${tone.className}`}
    >
      {tone.label}
    </span>
  );
}

/** Publisher favicon through /api/favicon; null when there's no domain or the icon fails to load. */
function useFavicon(domain?: string) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = domain && failed !== domain ? `/api/favicon?domain=${encodeURIComponent(domain)}` : null;
  return { src, onError: () => setFailed(domain ?? null) };
}

function SourceIcon({ source, domain }: { source?: string; domain?: string }) {
  const favicon = useFavicon(domain);
  return (
    <span
      aria-hidden
      className="inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-app-hairline-strong bg-app-chip text-[13px] font-semibold uppercase text-app-muted"
    >
      {favicon.src ? (
        <img src={favicon.src} alt="" width={18} height={18} loading="lazy" onError={favicon.onError} className="size-[18px] object-contain" />
      ) : (
        (source?.charAt(0) ?? "•")
      )}
    </span>
  );
}

function SourceFavicon({ domain }: { domain?: string }) {
  const favicon = useFavicon(domain);
  if (!favicon.src) return null;
  return <img src={favicon.src} alt="" width={12} height={12} loading="lazy" onError={favicon.onError} className="size-3 shrink-0 rounded-[2px] object-contain" />;
}

export function NewsCard({ item, onSelectAsset, selectedSymbol, renderLeadActions, isSelected, isFlashing, onSelect }: NewsCardProps) {
  const t = useT();
  const chips = chipsFor(item);
  const [source, ...otherSources] = item.sources;
  const publishedAt = item.publishedAt ? new Date(item.publishedAt) : null;

  return (
    <article
      onClick={onSelect}
      aria-current={isSelected || undefined}
      className={`group relative -mx-3 flex cursor-default gap-3 border-b border-app-hairline px-3 py-[var(--news-padding)] transition-colors last:border-b-0 hover:bg-app-chip/25 ${
        isSelected ? "bg-app-chip/45" : ""
      } ${isFlashing ? "news-flash" : ""}`}
    >
      <span aria-hidden className={`absolute inset-y-2 left-0 w-[3px] rounded-r ${isSelected ? "bg-app-accent" : accent[item.severity]}`} />

      {chips.length > 0 ? <MarketIcon symbol={item.symbol} size={32} /> : <SourceIcon source={source} domain={item.sourceDomain} />}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px] text-app-muted">
          {item.enriched ? (
            <SeverityBadge severity={item.severity} />
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded bg-app-chip px-1.5 py-[3px] text-[10px] font-semibold uppercase leading-none tracking-[0.08em] text-app-muted">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-app-accent" />
              Raw
            </span>
          )}
          {source && (
            <span className="inline-flex min-w-0 items-center gap-1 font-medium text-app-ink/80" title={item.sources.join(", ")}>
              <SourceFavicon domain={item.sourceDomain} />
              <span className="truncate">{source}</span>
              {otherSources.length > 0 && <span className="shrink-0 text-app-faint">+{otherSources.length}</span>}
            </span>
          )}
          {item.alerted && <Bell className="size-3 shrink-0 text-[#c27c12]" aria-label={t("news.alertSet")} />}
          <time
            dateTime={publishedAt?.toISOString()}
            title={publishedAt?.toLocaleString()}
            className="ml-auto shrink-0 tabular-nums text-app-faint"
          >
            {formatRelativeTime(item.minutesAgo, t)}
          </time>
        </div>

        <h3 className="mt-1 text-[14px] font-semibold leading-snug text-app-ink">
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="decoration-app-faint underline-offset-2 hover:underline"
            >
              {item.headline}
              <ExternalLink className="ml-1 inline size-3 align-baseline text-app-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </a>
          ) : (
            item.headline
          )}
        </h3>

        {item.summary && <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-app-muted">{item.summary}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
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
                className={`rounded-md border px-1.5 py-0.5 transition-colors hover:bg-app-chip ${
                  selectedSymbol === chip.symbol ? "border-app-hairline-strong bg-app-chip" : "border-app-hairline"
                }`}
              >
                <SymbolChip symbol={chip.symbol} direction={chip.direction} />
              </button>
              {index === 0 && renderLeadActions?.({ symbol: chip.symbol, direction: chip.direction, mint: item.mints?.[chip.symbol] })}
            </span>
          ))}
          <span className="ml-auto inline-flex items-center gap-2">
            {item.enriched && <SentimentPill sentiment={item.sentiment} />}
            <ImpactMeter item={item} />
          </span>
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
