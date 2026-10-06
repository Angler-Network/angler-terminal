"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useSelectedAsset } from "@/components/terminal/selected-asset";
import { useTradeTicket } from "@/components/terminal/trade-ticket";
import { notifyNews } from "@/lib/alerts/notify";
import { playAlertSound } from "@/lib/alerts/sounds";
import { useNewsFeed, type FeedStatus } from "@/lib/angler/use-news-feed";
import { countActiveFilters, filterNews } from "@/lib/news/filter";
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
function useHighImpactFlash(items: NewsItem[], onOpen: (id: string) => void) {
  const { preferences } = usePreferences();
  const notifyRef = useRef({ on: preferences.newsNotifications, onOpen });
  notifyRef.current = { on: preferences.newsNotifications, onOpen };
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
    if (notifyRef.current.on) {
      // A burst (e.g. after reconnecting) notifies for the newest few only.
      for (const id of fresh.slice(0, 3)) {
        const item = items.find((entry) => entry.id === id);
        if (item) notifyNews(item, notifyRef.current.onOpen);
      }
    }
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
}

export function NewsFeed({ feed }: NewsFeedProps) {
  const { symbol, selectAsset, newsFocus, clearNewsFocus } = useSelectedAsset();
  const { preferences, updatePreference, openSettings } = usePreferences();
  const { ticket, press, confirm, cancel, setSizePreset, selectedNewsId, selectNews } = useTradeTicket();
  const { items, status, liveError, hasMore, isLoadingMore, loadMore, historyError } = feed;
  const filters = preferences.newsFilters;
  const minImportance = filters.minImpact;
  const shown = useMemo(() => filterNews(items, filters, newsFocus), [items, filters, newsFocus]);
  const activeFilters = countActiveFilters(filters);
  const flashing = useHighImpactFlash(items, selectNews);
  useNewsSound(items, shown, status === "live");

  // Tradable assets per news item (by symbol), so shortcuts can trade the selected item's lead asset.
  const [resolved, setResolved] = useState<Record<string, Record<string, ResolvedNewsTrade | null>>>({});
  const onResolved = useCallback((newsId: string, symbol: string, trade: ResolvedNewsTrade | null) => {
    setResolved((current) => {
      const previous = current[newsId]?.[symbol];
      if (previous === trade || (previous && trade && previous.venue === trade.venue && previous.mint === trade.mint && previous.spotVenue === trade.spotVenue)) return current;
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
              onClick={() => updatePreference("newsFilters", { ...filters, minImpact: value })}
              title={value === 0 ? "All news" : `Importance ${value}+`}
              className={`h-6 rounded-md px-1.5 text-[11px] font-semibold tabular-nums transition-colors ${
                minImportance === value ? "bg-app-card text-app-ink shadow-sm" : "text-app-muted hover:text-app-ink"
              }`}
            >
              {value === 0 ? "All" : `${value}+`}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => openSettings("filters")}
          title={activeFilters > 0 ? `News filters (${activeFilters} active)` : "News filters"}
          aria-label="News filters"
          className={`relative grid size-7 place-items-center rounded-lg transition-colors hover:bg-app-chip hover:text-app-ink ${
            activeFilters > 0 ? "text-app-ink" : "text-app-muted"
          }`}
        >
          <SlidersHorizontal className="size-3.5" />
          {activeFilters > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-3.5 place-items-center rounded-full bg-app-accent px-0.5 text-[9px] font-bold leading-[14px] text-app-on-accent">
              {activeFilters}
            </span>
          )}
        </button>
      </header>
      {(newsFocus || filters.assets.length > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-app-hairline px-3 py-1.5 text-[11px] text-app-muted">
          {newsFocus && (
            <button
              type="button"
              onClick={clearNewsFocus}
              title="Show all news again"
              className="inline-flex h-6 items-center gap-1 rounded-full border border-app-hairline-strong bg-app-chip pl-2 pr-1.5 font-semibold text-app-ink transition-colors hover:bg-app-card"
            >
              Only {newsFocus}
              <X className="size-3" aria-label="Clear" />
            </button>
          )}
          {filters.assets.length > 0 && (
            <button
              type="button"
              onClick={() => openSettings("filters")}
              className="truncate transition-colors hover:text-app-ink"
            >
              Filtered to {filters.assets.join(", ")}
            </button>
          )}
        </div>
      )}

      <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto px-3">
        {status === "unconfigured" && (
          <p className="py-6 text-center text-[12px] text-app-muted">
            Set ANGLER_API_KEY in .env.local and restart the server to stream news.
          </p>
        )}
        {historyError && <p className="py-3 text-center text-[12px] text-app-danger">{historyError}</p>}
        {shown.length === 0 && items.length > 0 && (
          <div className="py-6 text-center text-[12px] text-app-muted">
            <p>No news matches {newsFocus ? `${newsFocus} and your filters` : "your filters"} yet.</p>
            <button
              type="button"
              onClick={() => (newsFocus ? clearNewsFocus() : openSettings("filters"))}
              className="mt-2 font-semibold text-app-ink underline-offset-2 hover:underline"
            >
              {newsFocus ? "Show all news" : "Edit filters"}
            </button>
          </div>
        )}
        {items.length === 0 && status !== "unconfigured" && !historyError && (
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
      {/* Keyboard hints only for a selected tradable item. */}
      {selectedTrade && (
        <footer className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-app-hairline px-3 py-1.5 text-[10px] text-app-faint">
          <Kbd>L</Kbd> {selectedTrade.venue === "perp" ? "long" : "buy"}
          <Kbd>S</Kbd> {selectedTrade.venue === "perp" ? "short" : "sell"}
          <Kbd>1-4</Kbd> size
          <Kbd>Enter</Kbd> confirm
          <Kbd>Esc</Kbd> cancel
        </footer>
      )}
    </section>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-app-hairline-strong bg-app-chip px-1 font-sans font-semibold text-app-muted">{children}</kbd>;
}
