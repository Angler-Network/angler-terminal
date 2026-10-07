"use client";

import { useEffect, useRef, useState } from "react";
import type { PredictionBook, PredictionRange, PricePoint } from "@/lib/prediction/market-data";
import type { PredictionEvent, PredictionSource } from "@/lib/prediction/types";

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Fetches `url` and refetches every `refreshMs` while the tab is visible. A new url drops the old data so a slow
 * answer for the previous selection never shows under the new one.
 */
function usePolled<T>(url: string | null, refreshMs: number): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: null, error: null, loading: Boolean(url) });
  const current = useRef(url);

  useEffect(() => {
    current.current = url;
    setState({ data: null, error: null, loading: Boolean(url) });
    if (!url) return;
    let timer: number | null = null;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        const body = (await response.json()) as T & { error?: string };
        if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
        if (current.current === url) setState({ data: body, error: null, loading: false });
      } catch (error) {
        if (controller.signal.aborted || current.current !== url) return;
        setState((previous) => ({ data: previous.data, error: error instanceof Error ? error.message : String(error), loading: false }));
      }
      if (refreshMs > 0 && !controller.signal.aborted) timer = window.setTimeout(tick, refreshMs);
    };
    const tick = () => {
      if (document.visibilityState === "visible") void load();
      else timer = window.setTimeout(tick, refreshMs);
    };
    void load();
    return () => {
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [url, refreshMs]);

  return state;
}

export function usePredictionEvents(source: PredictionSource | "all", query: string) {
  const params = new URLSearchParams({ source });
  if (query) params.set("q", query);
  return usePolled<{ events: PredictionEvent[]; failed: PredictionSource[] }>(`/api/prediction/events?${params}`, 30_000);
}

export function usePredictionEvent(id: string | null) {
  return usePolled<PredictionEvent>(id ? `/api/prediction/event?id=${encodeURIComponent(id)}` : null, 10_000);
}

export function usePriceHistory(source: PredictionSource | null, asset: string | null, range: PredictionRange) {
  const url = source && asset ? `/api/prediction/history?${new URLSearchParams({ source, asset, range })}` : null;
  return usePolled<{ points: PricePoint[] }>(url, 60_000);
}

export function usePredictionBook(source: PredictionSource | null, asset: string | null) {
  const url = source && asset ? `/api/prediction/book?${new URLSearchParams({ source, asset })}` : null;
  return usePolled<PredictionBook>(url, 3_000);
}
