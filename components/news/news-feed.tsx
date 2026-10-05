"use client";

import { useState } from "react";
import { useSelectedAsset } from "@/components/terminal/selected-asset";
import { useNewsFeed, type FeedStatus } from "@/lib/angler/use-news-feed";
import { NewsCard } from "./news-card";
import { useNewsSound } from "./use-news-sound";

const IMPORTANCE_FILTERS = [0, 40, 60, 80];

const statusLabels: Record<FeedStatus, { label: string; dot: string }> = {
  connecting: { label: "Connecting", dot: "bg-app-faint animate-pulse" },
  live: { label: "Live", dot: "bg-app-up" },
  reconnecting: { label: "Reconnecting", dot: "bg-[#f5c97b] animate-pulse" },
  offline: { label: "Offline", dot: "bg-app-down" },
  unconfigured: { label: "No API key", dot: "bg-app-down" },
};

function FeedStatusBadge({ status }: { status: FeedStatus }) {
  const { label, dot } = statusLabels[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-app-muted">
      <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

interface NewsFeedProps {
  /** Owned by the shell so the chart can mark the same news on its candles. */
  feed: ReturnType<typeof useNewsFeed>;
  minImportance: number;
  onMinImportance: (value: number) => void;
}

export function NewsFeed({ feed, minImportance, onMinImportance }: NewsFeedProps) {
  const { symbol, selectAsset } = useSelectedAsset();
  const [onlySelected, setOnlySelected] = useState(false);
  const { items, status, hasMore, isLoadingMore, loadMore, historyError } = feed;
  const shown = onlySelected ? items.filter((item) => item.coins?.includes(symbol)) : items;
  useNewsSound(items, shown, status === "live");

  return (
    <section
      aria-label="News"
      className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-app-hairline px-3 py-2">
        <h2 className="text-[13px] font-semibold text-app-ink">News</h2>
        <FeedStatusBadge status={status} />
        <div role="group" aria-label="Minimum importance" className="ml-auto flex gap-0.5 rounded-lg bg-app-chip p-0.5">
          {IMPORTANCE_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={minImportance === value}
              onClick={() => onMinImportance(value)}
              title={value === 0 ? "All news" : `Importance ${value}+`}
              className={`h-6 rounded-md px-1.5 text-[11px] font-semibold tabular-nums transition-colors ${
                minImportance === value ? "bg-app-card text-app-ink shadow-sm" : "text-app-muted hover:text-app-ink"
              }`}
            >
              {value === 0 ? "All" : `${value}+`}
            </button>
          ))}
        </div>
      </header>
      <label className="flex shrink-0 items-center gap-2 border-b border-app-hairline px-3 py-1.5 text-[12px] text-app-muted">
        <input
          type="checkbox"
          checked={onlySelected}
          onChange={(event) => setOnlySelected(event.target.checked)}
          className="accent-[rgb(var(--app-accent))]"
        />
        Only ${symbol}
      </label>

      <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto px-3">
        {status === "unconfigured" && (
          <p className="py-6 text-center text-[12px] text-app-muted">
            Set ANGLER_API_KEY in .env.local and restart the server to stream news.
          </p>
        )}
        {historyError && <p className="py-3 text-center text-[12px] text-app-danger">{historyError}</p>}
        {shown.length === 0 && status !== "unconfigured" && !historyError && (
          <p className="py-6 text-center text-[12px] text-app-muted">Waiting for news…</p>
        )}
        {shown.map((item) => (
          <NewsCard key={item.id} item={item} onSelectAsset={selectAsset} selectedSymbol={symbol} />
        ))}
        {hasMore && (
          <div className="py-3 text-center">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={isLoadingMore}
              className="h-8 rounded-lg border border-app-hairline-strong bg-app-chip px-3 text-[12px] font-semibold text-app-ink transition-colors hover:bg-app-card disabled:opacity-60"
            >
              {isLoadingMore ? "Loading…" : "Load older"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
