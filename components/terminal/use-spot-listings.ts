"use client";

import { useEffect, useMemo, useState } from "react";
import { SPOT_EVM_LISTINGS_PATH, SPOT_LISTINGS_PATH, type SpotListing } from "@/lib/spot/listings";

const TTL_MS = 60_000;
const SEARCH_DELAY_MS = 250;

type Part = "core" | "evm";
const caches: Record<Part, { at: number; promise: Promise<SpotListing[]> } | null> = { core: null, evm: null };

/**
 * One shared request per part for every consumer (search, watchlist, swap cards), refreshed at most every minute:
 * `core` (preloaded with the page) and `evm` (the EVM tokens, about 90% of the bytes).
 */
export function loadSpotListings(part: Part = "core") {
  const cached = caches[part];
  if (cached && Date.now() - cached.at <= TTL_MS) return cached.promise;
  // Same URL and credentials mode as the pages' `preload`, so the first core read reuses that in-flight response.
  const promise = fetch(part === "core" ? SPOT_LISTINGS_PATH : SPOT_EVM_LISTINGS_PATH)
    .then((response) => {
      // A failed load is dropped from the cache (below) so the next read asks again, not kept as an empty list.
      if (!response.ok) throw new Error(`Spot listings answered ${response.status}`);
      return response.json() as Promise<{ listings: SpotListing[] }>;
    })
    .then((body) => (Array.isArray(body.listings) ? body.listings : []));
  caches[part] = { at: Date.now(), promise };
  promise.catch(() => caches[part]?.promise === promise && (caches[part] = null));
  return promise;
}

/**
 * Every spot pair of the integrated venues; null until loaded (or while `enabled` is false). The core list shows as
 * soon as it lands and the EVM tokens join it a moment later; `waitForEvm` holds the answer until both are in (for
 * readers that look up an EVM token, which would otherwise call it unknown).
 */
export function useSpotListings(enabled = true, { waitForEvm = false }: { waitForEvm?: boolean } = {}) {
  const [parts, setParts] = useState<{ core: SpotListing[] | null; evm: SpotListing[] | null }>({ core: null, evm: null });
  useEffect(() => {
    if (!enabled) return;
    let isActive = true;
    const read = (part: Part) =>
      loadSpotListings(part)
        .then((next) => isActive && setParts((current) => ({ ...current, [part]: next })))
        .catch(() => isActive && setParts((current) => ({ ...current, [part]: current[part] ?? [] })));
    // The EVM part after the core one, so it never competes with what the first screen shows.
    const both = () => void read("core").finally(() => isActive && void read("evm"));
    both();
    const timer = window.setInterval(both, TTL_MS);
    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return useMemo(() => {
    if (!parts.core || (waitForEvm && !parts.evm)) return null;
    return parts.evm ? [...parts.core, ...parts.evm] : parts.core;
  }, [parts, waitForEvm]);
}

/** Live spot search (ticker, name or address) for queries of two characters or more, debounced. */
export function useSpotSearch(query: string) {
  const [state, setState] = useState<{ query: string; listings: SpotListing[] } | null>(null);
  const wanted = query.trim();
  useEffect(() => {
    if (wanted.length < 2) return;
    let isActive = true;
    const timer = window.setTimeout(() => {
      fetch(`/api/spot/search?q=${encodeURIComponent(wanted)}`)
        .then((response) => (response.ok ? (response.json() as Promise<{ listings: SpotListing[] }>) : { listings: [] }))
        .then((body) => isActive && setState({ query: wanted, listings: body.listings ?? [] }))
        .catch(() => isActive && setState({ query: wanted, listings: [] }));
    }, SEARCH_DELAY_MS);
    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [wanted]);
  if (wanted.length < 2) return null;
  return state?.query === wanted ? state.listings : undefined;
}
