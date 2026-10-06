"use client";

import { Centrifuge, type PublicationContext } from "centrifuge";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NewsItem } from "@/lib/types";
import { mergeFeedNews, readNewsPage, readSources, readStageMessage, sourceNames, toNewsItem } from "./map";
import { NEWS_CHANNELS, type FeedNews, type SourceNames, type WsTicketResponse } from "./types";

const PAGE_SIZE = 50;
const MAX_ITEMS = 600;
const CLOCK_MS = 30_000;
/** If realtime isn't up by then, poll REST so the feed keeps moving. */
const LIVE_GRACE_MS = 10_000;
const POLL_MS = 15_000;
const POLL_SIZE = 30;

export type FeedStatus = "connecting" | "live" | "reconnecting" | "polling" | "offline" | "unconfigured";

class UnconfiguredError extends Error {}

async function fetchTicket(): Promise<WsTicketResponse> {
  const response = await fetch("/api/ws-ticket", { method: "POST", cache: "no-store" });
  if (response.status === 503) throw new UnconfiguredError("ANGLER_API_KEY is not set");
  if (!response.ok) throw new Error(`Ticket request failed (${response.status})`);
  return (await response.json()) as WsTicketResponse;
}

async function fetchSourceNames(): Promise<SourceNames | null> {
  const response = await fetch("/api/sources");
  return response.ok ? sourceNames(readSources(await response.json())) : null;
}

function publishedAt(news: FeedNews) {
  return news.publishedAt ? Date.parse(news.publishedAt) || 0 : 0;
}

/**
 * Live Angler news: history from /api/news, then news.raw and news.enriched over Centrifugo. Publications are
 * stage messages keyed by `news_item_id`, so the enriched payload upserts the raw one in place.
 */
export function useNewsFeed({ minImportance = 0, coin, translate = true }: { minImportance?: number; coin?: string; translate?: boolean } = {}) {
  const [store, setStore] = useState<Map<string, FeedNews>>(() => new Map());
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [names, setNames] = useState<SourceNames | undefined>(undefined);
  /** Last realtime problem, readable, for the status tooltip. Never contains the ticket. */
  const [liveError, setLiveError] = useState<string | null>(null);
  const minImportanceRef = useRef(minImportance);
  minImportanceRef.current = minImportance;
  /** When one asset is in focus, history pages are requested for that coin so older items for it show up. */
  const coinRef = useRef(coin);
  coinRef.current = coin;

  const upsert = useCallback((incoming: FeedNews[]) => {
    if (incoming.length === 0) return;
    setStore((current) => {
      const next = new Map(current);
      for (const news of incoming) next.set(news.id, mergeFeedNews(next.get(news.id), news));
      if (next.size <= MAX_ITEMS) return next;
      const newest = [...next.values()].sort((a, b) => publishedAt(b) - publishedAt(a)).slice(0, MAX_ITEMS);
      return new Map(newest.map((news) => [news.id, news]));
    });
  }, []);

  const loadPage = useCallback(
    async (pageCursor: string | null) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (minImportanceRef.current > 0) params.set("min_importance", String(minImportanceRef.current));
      if (coinRef.current) params.set("coin", coinRef.current);
      if (pageCursor) params.set("cursor", pageCursor);
      const response = await fetch(`/api/news?${params}`, { cache: "no-store" });
      if (response.status === 503) {
        setStatus("unconfigured");
        throw new UnconfiguredError("ANGLER_API_KEY is not set");
      }
      if (!response.ok) throw new Error(`News request failed (${response.status})`);
      const page = readNewsPage(await response.json());
      upsert(page.items);
      setCursor(page.nextCursor);
    },
    [upsert],
  );

  useEffect(() => {
    let isActive = true;
    fetchSourceNames()
      .then((loaded) => isActive && loaded && setNames(loaded))
      .catch(() => {});
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;
    setHistoryError(null);
    setCursor(null);
    loadPage(null).catch((error: unknown) => {
      if (isActive && !(error instanceof UnconfiguredError)) setHistoryError("Couldn't load recent news.");
    });
    return () => {
      isActive = false;
    };
  }, [loadPage, minImportance, coin]);

  const loadMore = useCallback(async () => {
    if (!cursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      await loadPage(cursor);
    } catch {
      setHistoryError("Couldn't load older news.");
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, isLoadingMore, loadPage]);

  useEffect(() => {
    let client: Centrifuge | null = null;
    let isActive = true;
    let retryTimer: number | undefined;

    const onPublication = (context: PublicationContext) => {
      const news = readStageMessage(context.data);
      if (news) upsert([news]);
    };
    const report = (message: string) => {
      if (!isActive) return;
      setLiveError(message);
      console.warn(`[angler] realtime: ${message}`);
    };

    // The first ticket tells us where to connect; getData then mints a fresh one for every later attempt.
    const start = async () => {
      let first: WsTicketResponse | null;
      try {
        first = await fetchTicket();
      } catch (error) {
        if (!isActive) return;
        if (error instanceof UnconfiguredError) setStatus("unconfigured");
        else {
          report(error instanceof Error ? error.message : "Ticket request failed");
          setStatus((current) => (current === "polling" ? current : "offline"));
          retryTimer = window.setTimeout(() => isActive && void start(), 5000);
        }
        return;
      }
      if (!isActive) return;
      client = new Centrifuge(first.url, {
        getData: async () => {
          const ticket = first ?? (await fetchTicket());
          first = null;
          return { ticket: ticket.ticket };
        },
      });
      client.on("connecting", (context) => {
        // Code 0 is the initial connect; anything else is a retry after a failure.
        if (context.code !== 0) report(`${context.reason} (code ${context.code})`);
        setStatus((current) => (current === "live" ? "reconnecting" : current));
      });
      // Live means subscribed, not just connected: the server can refuse the channels on an open connection.
      const subscribed = new Set<string>();
      client.on("connected", () => setLiveError(null));
      client.on("disconnected", (context) => {
        report(`disconnected: ${context.reason} (code ${context.code})`);
        setStatus("offline");
      });
      client.on("error", (context) => {
        const message = context.error?.message ?? context.type;
        if (message.includes("ANGLER_API_KEY")) setStatus("unconfigured");
        else report(`${context.type} error: ${message}`);
      });
      for (const channel of NEWS_CHANNELS) {
        const subscription = client.newSubscription(channel);
        subscription.on("publication", onPublication);
        subscription.on("subscribed", () => {
          subscribed.add(channel);
          setStatus("live");
        });
        subscription.on("subscribing", () => subscribed.delete(channel));
        // The server unsubscribes with its own code, e.g. 1003 "delayed tier has no real-time subscription" for
        // free-tier keys. Without a live channel the REST poll takes over.
        subscription.on("unsubscribed", (context) => {
          subscribed.delete(channel);
          if (context.code === 0) return;
          report(`${channel}: ${context.reason} (code ${context.code})`);
          if (subscribed.size === 0) setStatus("offline");
        });
        subscription.on("error", (context) => report(`subscribe ${channel}: ${context.error?.message ?? "failed"}`));
        subscription.subscribe();
      }
      client.connect();
    };

    void start();
    return () => {
      isActive = false;
      window.clearTimeout(retryTimer);
      client?.disconnect();
    };
  }, [upsert]);

  // Fallback: while realtime isn't live, poll the latest page so new headlines still arrive.
  useEffect(() => {
    if (status === "live" || status === "unconfigured") return;
    let isActive = true;
    const poll = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const params = new URLSearchParams({ limit: String(POLL_SIZE) });
        if (minImportanceRef.current > 0) params.set("min_importance", String(minImportanceRef.current));
        const response = await fetch(`/api/news?${params}`, { cache: "no-store" });
        if (!isActive || !response.ok) return;
        upsert(readNewsPage(await response.json()).items);
        setStatus((current) => (current === "live" || current === "unconfigured" ? current : "polling"));
      } catch {}
    };
    const grace = window.setTimeout(() => {
      void poll();
      timer = window.setInterval(poll, POLL_MS);
    }, status === "polling" ? 0 : LIVE_GRACE_MS);
    let timer: number | undefined;
    return () => {
      isActive = false;
      window.clearTimeout(grace);
      window.clearInterval(timer);
    };
  }, [status === "live" || status === "unconfigured", upsert]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const items = useMemo<NewsItem[]>(
    () =>
      [...store.values()]
        .map((news) => toNewsItem(news, now, names, translate))
        .filter((item) => !item.enriched || item.score >= minImportance)
        .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)),
    [store, now, minImportance, names, translate],
  );

  return { items, status, liveError, hasMore: Boolean(cursor), isLoadingMore, loadMore, historyError };
}
