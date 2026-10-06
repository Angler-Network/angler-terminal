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
  /** Replaces the asset chips with a trade grid (important items with tradable assets). */
  renderTrade?: (assets: { symbol: string; direction: Direction; mint?: string }[]) => React.ReactNode;
  isSelected?: boolean;
  /** Briefly highlights a high-impact arrival. */
  isFlashing?: boolean;
  onSelect?: () => void;
  /** Terminal addition: tighter card for the narrow feed column next to the trading panels. */
  compact?: boolean;
  /** Terminal addition: rendered under the card's trade controls (e.g. how the asset moved after similar news). */
  extra?: React.ReactNode;
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

/** Where the model's sentiment sits between -1 (bearish) and +1 (bullish): a dot on a red-to-green track. */
function SentimentMeter({ sentiment }: { sentiment: number }) {
  const value = Math.max(-1, Math.min(1, sentiment));
  const color = value >= NEUTRAL_SENTIMENT ? "bg-app-up" : value <= -NEUTRAL_SENTIMENT ? "bg-app-down" : "bg-app-muted";
  const text = value >= NEUTRAL_SENTIMENT ? "text-app-up" : value <= -NEUTRAL_SENTIMENT ? "text-app-down" : "text-app-muted";
  return (
    <span className="inline-flex items-center gap-1.5" title={`Sentiment ${value.toFixed(2)} on a -1 to +1 scale (model output)`}>
      <span aria-hidden className="text-[10px] font-semibold tabular-nums text-app-faint">-1</span>
      <span
        role="meter"
        aria-label="Sentiment"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={Number(value.toFixed(2))}
        className="relative h-1.5 w-16 rounded-full bg-gradient-to-r from-app-down/50 via-app-chip to-app-up/50"
      >
        <span aria-hidden className="absolute left-1/2 top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-app-hairline-strong" />
        <span
          aria-hidden
          className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-app-card ${color}`}
          style={{ left: `${((value + 1) / 2) * 100}%` }}
        />
      </span>
      <span aria-hidden className="text-[10px] font-semibold tabular-nums text-app-faint">+1</span>
      <span className={`min-w-[2.5em] text-right text-[11px] font-semibold tabular-nums ${text}`}>
        {value > 0 ? "+" : ""}
        {value.toFixed(2)}
      </span>
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

function SourceIcon({ source, domain, compact }: { source?: string; domain?: string; compact?: boolean }) {
  const favicon = useFavicon(domain);
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden border border-app-hairline-strong bg-app-chip font-semibold uppercase text-app-muted ${
        compact ? "size-6 rounded-md text-[11px]" : "size-8 rounded-lg text-[13px]"
      }`}
    >
      {favicon.src ? (
        <img src={favicon.src} alt="" width={18} height={18} loading="lazy" onError={favicon.onError} className={`object-contain ${compact ? "size-3.5" : "size-[18px]"}`} />
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

export function NewsCard({ item, onSelectAsset, selectedSymbol, renderTrade, isSelected, isFlashing, onSelect, compact, extra }: NewsCardProps) {
  const t = useT();
  const chips = chipsFor(item);
  const trade = chips.length > 0 && renderTrade ? renderTrade(chips.slice(0, 3).map((chip) => ({ ...chip, mint: item.mints?.[chip.symbol] }))) : null;
  const [source, ...otherSources] = item.sources;
  const publishedAt = item.publishedAt ? new Date(item.publishedAt) : null;

  return (
    <article
      onClick={onSelect}
      aria-current={isSelected || undefined}
      className={`group relative -mx-3 flex cursor-default border-b border-app-hairline px-3 transition-colors ${
        compact ? "gap-2.5 py-[min(var(--news-padding),10px)]" : "gap-3 py-[var(--news-padding)]"
      } last:border-b-0 hover:bg-app-chip/25 ${
        isSelected ? "bg-app-chip/45" : ""
      } ${isFlashing ? "news-flash" : ""}`}
    >
      <span aria-hidden className={`absolute inset-y-2 left-0 w-[3px] rounded-r ${isSelected ? "bg-app-accent" : accent[item.severity]}`} />

      {chips.length > 0 ? (
        <MarketIcon symbol={item.symbol} size={compact ? 24 : 32} />
      ) : (
        <SourceIcon source={source} domain={item.sourceDomain} compact={compact} />
      )}

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
          {item.originalHeadline && (
            <span
              title={item.originalHeadline}
              className="shrink-0 rounded bg-app-chip px-1 py-[2px] text-[9px] font-semibold uppercase leading-none tracking-[0.06em] text-app-faint"
            >
              {item.lang ? `${item.lang.split("-")[0]} → EN` : "Translated"}
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

        <h3 title={item.originalHeadline} className={`mt-1 font-semibold leading-snug text-app-ink ${compact ? "text-[13px]" : "text-[14px]"}`}>
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

        {item.summary && <p className={`mt-1 line-clamp-2 leading-snug text-app-muted ${compact ? "text-[11.5px]" : "text-[12px]"}`}>{item.summary}</p>}

        <div className={`${compact ? "mt-1.5" : "mt-2"} flex flex-wrap items-center gap-x-2 gap-y-1.5`}>
          {!trade && chips.map((chip) => (
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
            </span>
          ))}
          {item.enriched && item.hasSentiment !== false && <SentimentMeter sentiment={item.sentiment} />}
          <span className="ml-auto inline-flex items-center gap-2">
            {item.enriched && item.hasSentiment !== false && <SentimentPill sentiment={item.sentiment} />}
            <ImpactMeter item={item} />
          </span>
        </div>

        {trade}
        {extra}

        {item.marketReaction && (
          <div className="mt-3">
            <MarketReactionButton />
          </div>
        )}
      </div>
    </article>
  );
}
