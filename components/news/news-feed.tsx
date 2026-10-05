"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useSelectedAsset } from "@/components/terminal/selected-asset";
import { useTradeTicket } from "@/components/terminal/trade-ticket";
import { playAlertSound } from "@/lib/alerts/sounds";
import { useNewsFeed, type FeedStatus } from "@/lib/angler/use-news-feed";
import { detectHighImpact, isTypingTarget } from "@/lib/trading/high-impact";
import type { NewsItem } from "@/lib/types";
import { NewsCard } from "./news-card";
import { NewsTradeGrid, type ResolvedNewsTrade } from "./news-trade-grid";
import { useNewsSound } from "./use-news-sound";

const IMPORTANCE_FILTERS = [0, 40, 60, 80];
const FLASH_MS = 4_000;

const statusLabels: Record<FeedStatus, { label: string; dot: string; hint: string }> = {
  connecting: { label: "Connecting", dot: "bg-app-faint animate-pulse", hint: "Opening the realtime connection." },
  live: { label: "Live", dot: "bg-app-up shadow-[0_0_0_3px_rgb(var(--app-up)/0.2)]", hint: "Streaming news in real time." },
  reconnecting: { label: "Reconnecting", dot: "bg-[#f5c97b] animate-pulse", hint: "Realtime dropped; reconnecting." },
  polling: { label: "Polling", dot: "bg-[#f5c97b]", hint: "Realtime is unavailable, so the feed refreshes every 15 seconds." },
  offline: { label: "Offline", dot: "bg-app-down", hint: "Can't reach the news service." },
  unconfigured: { label: "No API key", dot: "bg-app-down", hint: "Set ANGLER_API_KEY on the server." },
};

function FeedStatusBadge({ status, error }: { status: FeedStatus; error: string | null }) {
  const { label, dot, hint } = statusLabels[status];
  return (
    <span
      title={error && status !== "live" ? `${hint}\nLast error: ${error}` : hint}
      className="inline-flex items-center gap-1.5 rounded-full border border-app-hairline px-2 py-0.5 text-[11px] font-medium text-app-muted"
    >
      <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

/** Highlights high-impact arrivals for a few seconds and optionally plays a sound. Never trades. */
function useHighImpactFlash(items: NewsItem[]) {
  const { preferences } = usePreferences();
  const knownRef = useRef<Set<string> | null>(null);
  const [flashing, setFlashing] = useState<Set<string>>(() => new Set());
  const soundRef = useRef({ on: preferences.highImpactSound, volume: preferences.alertVolume });
  soundRef.current = { on: preferences.highImpactSound, volume: preferences.alertVolume };

  useEffect(() => {
    // Wait for the first real load so history doesn't flash.
    if (items.length === 0 && !knownRef.current) return;
    const { known, fresh } = detectHighImpact(knownRef.current, items, preferences.highImpactThreshold);
    knownRef.current = known;
    if (fresh.length === 0) return;
    setFlashing((current) => new Set([...current, ...fresh]));
    if (soundRef.current.on) playAlertSound("bell", soundRef.current.volume);
    const timer = window.setTimeout(
      () => setFlashing((current) => new Set([...current].filter((id) => !fresh.includes(id)))),
      FLASH_MS,
    );
    return () => window.clearTimeout(timer);
  }, [items, preferences.highImpactThreshold]);

  return flashing;
}

interface NewsFeedProps {
  /** Owned by the shell so the chart can mark the same news on its candles. */
  feed: ReturnType<typeof useNewsFeed>;
  minImportance: number;
  onMinImportance: (value: number) => void;
}

export function NewsFeed({ feed, minImportance, onMinImportance }: NewsFeedProps) {
  const { symbol, selectAsset } = useSelectedAsset();
  const { preferences } = usePreferences();
  const { ticket, press, confirm, cancel, setSizePreset, selectedNewsId, selectNews } = useTradeTicket();
  const [onlySelected, setOnlySelected] = useState(false);
  const { items, status, liveError, hasMore, isLoadingMore, loadMore, historyError } = feed;
  const shown = onlySelected ? items.filter((item) => item.coins?.includes(symbol)) : items;
  const flashing = useHighImpactFlash(items);
  useNewsSound(items, shown, status === "live");

  // Tradable assets per news item (by symbol), so shortcuts can trade the selected item's lead asset.
  const [resolved, setResolved] = useState<Record<string, Record<string, ResolvedNewsTrade | null>>>({});
  const onResolved = useCallback((newsId: string, symbol: string, trade: ResolvedNewsTrade | null) => {
    setResolved((current) => {
      const previous = current[newsId]?.[symbol];
      if (previous === trade || (previous && trade && previous.venue === trade.venue && previous.mint === trade.mint)) return current;
      return { ...current, [newsId]: { ...current[newsId], [symbol]: trade } };
    });
  }, []);
  const isTradable = (item: NewsItem) => item.enriched === true && item.score >= preferences.tradeMinImpact && (item.coins?.length ?? 0) > 0;
  const leadTrade = (newsId: string | null) => {
    const item = newsId ? items.find((entry) => entry.id === newsId) : undefined;
    if (!item || !isTradable(item)) return null;
    const byAsset = resolved[item.id] ?? {};
    for (const symbol of item.coins ?? []) if (byAsset[symbol]) return byAsset[symbol];
    return null;
  };

  // Shortcuts act on the selected news item: L long/buy, S short/sell (again or Enter confirms), 1-4 size, Esc cancel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target, event)) return;
      const key = event.key.toLowerCase();
      if (key === "escape" && ticket) {
        cancel();
        event.preventDefault();
        return;
      }
      if (key === "enter" && ticket) {
        confirm();
        event.preventDefault();
        return;
      }
      if (["1", "2", "3", "4"].includes(key) && ticket) {
        setSizePreset(Number(key) - 1);
        event.preventDefault();
        return;
      }
      if (key !== "l" && key !== "s") return;
      const trade = leadTrade(selectedNewsId);
      if (!trade || !selectedNewsId) return;
      event.preventDefault();
      const side = key === "l" ? "buy" : "sell";
      // Pressing the same side again keeps the armed size, so it confirms instead of re-arming at the default.
      const sameTicket = ticket && ticket.newsId === selectedNewsId && ticket.symbol === trade.symbol && ticket.side === side;
      press({ ...trade, side, newsId: selectedNewsId, sizeUsd: sameTicket ? ticket.sizeUsd : undefined });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selectedTrade = leadTrade(selectedNewsId);

  return (
    <section
      aria-label="News"
      className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-app-hairline px-3 py-2">
        <h2 className="text-[13px] font-semibold text-app-ink">News</h2>
        <FeedStatusBadge status={status} error={liveError} />
        {items.length > 0 && <span className="text-[11px] tabular-nums text-app-faint">{shown.length}</span>}
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
          <div className="flex flex-col gap-3 py-3" aria-label="Loading news">
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex gap-3">
                <span className="size-8 shrink-0 animate-pulse rounded-lg bg-app-chip" />
                <span className="flex flex-1 flex-col gap-1.5">
                  <span className="h-2.5 w-1/3 animate-pulse rounded bg-app-chip" />
                  <span className="h-3 w-full animate-pulse rounded bg-app-chip" />
                  <span className="h-3 w-2/3 animate-pulse rounded bg-app-chip" />
                </span>
              </div>
            ))}
          </div>
        )}
        {shown.map((item) => (
          <NewsCard
            key={item.id}
            item={item}
            onSelectAsset={selectAsset}
            selectedSymbol={symbol}
            isSelected={selectedNewsId === item.id}
            isFlashing={flashing.has(item.id)}
            onSelect={() => selectNews(item.id)}
            renderTrade={
              isTradable(item)
                ? (assets) => <NewsTradeGrid newsId={item.id} assets={assets} onResolved={onResolved} onSelectAsset={selectAsset} />
                : undefined
            }
          />
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
      <footer className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-app-hairline px-3 py-1.5 text-[10px] text-app-faint">
        {selectedTrade ? (
          <>
            <Kbd>L</Kbd> {selectedTrade.venue === "perp" ? "long" : "buy"}
            <Kbd>S</Kbd> {selectedTrade.venue === "perp" ? "short" : "sell"}
            <Kbd>1-4</Kbd> size
            <Kbd>Enter</Kbd> confirm
            <Kbd>Esc</Kbd> cancel
          </>
        ) : (
          <span>Important news with a tradable asset shows size buttons. Select one to use L / S.</span>
        )}
      </footer>
    </section>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-app-hairline-strong bg-app-chip px-1 font-sans font-semibold text-app-muted">{children}</kbd>;
}
