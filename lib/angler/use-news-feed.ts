"use client";

import { Centrifuge, type PublicationContext } from "centrifuge";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NewsItem } from "@/lib/types";
import { mergeApiNews, readApiNews, readNewsPage, toNewsItem } from "./map";
import { NEWS_CHANNELS, type ApiNews, type WsTicketResponse } from "./types";

const PAGE_SIZE = 50;
const MAX_ITEMS = 600;
const CLOCK_MS = 30_000;

export type FeedStatus = "connecting" | "live" | "reconnecting" | "offline" | "unconfigured";

class UnconfiguredError extends Error {}

async function fetchTicket(): Promise<WsTicketResponse> {
  const response = await fetch("/api/ws-ticket", { method: "POST", cache: "no-store" });
  if (response.status === 503) throw new UnconfiguredError("ANGLER_API_KEY is not set");
  if (!response.ok) throw new Error(`Ticket request failed (${response.status})`);
  return (await response.json()) as WsTicketResponse;
}

/** Publications carry the news object itself; tolerate a { data } or { news } envelope too. */
function readPublication(data: unknown) {
  const record = (data ?? {}) as Record<string, unknown>;
  return readApiNews(record) ?? readApiNews(record.data) ?? readApiNews(record.news);
}

function publishedAt(news: ApiNews) {
  return toNewsItem(news).publishedAt ?? 0;
}

/**
 * Live Angler news: history from /api/news, then news.raw and news.enriched over Centrifugo. Items are keyed
 * by news id, so the enriched payload upserts the raw one in place.
 */
export function useNewsFeed({ minImportance = 0 }: { minImportance?: number } = {}) {
  const [store, setStore] = useState<Map<string, ApiNews>>(() => new Map());
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const minImportanceRef = useRef(minImportance);
  minImportanceRef.current = minImportance;

  const upsert = useCallback((incoming: ApiNews[]) => {
    if (incoming.length === 0) return;
    setStore((current) => {
      const next = new Map(current);
      for (const news of incoming) next.set(news.id, mergeApiNews(next.get(news.id), news));
      if (next.size <= MAX_ITEMS) return next;
      const newest = [...next.values()].sort((a, b) => publishedAt(b) - publishedAt(a)).slice(0, MAX_ITEMS);
      return new Map(newest.map((news) => [news.id, news]));
    });
  }, []);

  const loadPage = useCallback(
    async (pageCursor: string | null) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (minImportanceRef.current > 0) params.set("min_importance", String(minImportanceRef.current));
      if (pageCursor) params.set("cursor", pageCursor);
      const response = await fetch(`/api/news?${params}`, { cache: "no-store" });
      if (response.status === 503) {
        setStatus("unconfigured");
        throw new UnconfiguredError("ANGLER_API_KEY is not set");
      }
      if (!response.ok) throw new Error(`News request failed (${response.status})`);
      const page = readNewsPage(await response.json());
      upsert(page.items);
      setCursor(page.next_cursor);
    },
    [upsert],
  );

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
  }, [loadPage, minImportance]);

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
    let wsUrl: string | null = null;
    let client: Centrifuge | null = null;
    let isActive = true;

    const onPublication = (context: PublicationContext) => {
      const news = readPublication(context.data);
      if (news) upsert([news]);
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
          setStatus("offline");
          window.setTimeout(() => isActive && void start(), 5000);
        }
        return;
      }
      if (!isActive) return;
      wsUrl = first.url;
      client = new Centrifuge(wsUrl, {
        getData: async () => {
          const ticket = first ?? (await fetchTicket());
          first = null;
          return { ticket: ticket.ticket };
        },
      });
      client.on("connecting", () => setStatus((current) => (current === "live" ? "reconnecting" : current)));
      client.on("connected", () => setStatus("live"));
      client.on("disconnected", () => setStatus("offline"));
      client.on("error", (context) => {
        if (context.error?.message?.includes("ANGLER_API_KEY")) setStatus("unconfigured");
      });
      for (const channel of NEWS_CHANNELS) {
        const subscription = client.newSubscription(channel);
        subscription.on("publication", onPublication);
        subscription.subscribe();
      }
      client.connect();
    };

    void start();
    return () => {
      isActive = false;
      client?.disconnect();
    };
  }, [upsert]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const items = useMemo<NewsItem[]>(
    () =>
      [...store.values()]
        .map((news) => toNewsItem(news, now))
        .filter((item) => !item.enriched || item.score >= minImportance)
        .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)),
    [store, now, minImportance],
  );

  return { items, status, hasMore: Boolean(cursor), isLoadingMore, loadMore, historyError };
}
