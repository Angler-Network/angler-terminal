"use client";

import { useEffect, useState } from "react";
import { SPOT_LISTINGS_PATH, type SpotListing } from "@/lib/spot/listings";

const TTL_MS = 60_000;
const SEARCH_DELAY_MS = 250;

let cache: { at: number; promise: Promise<SpotListing[]> } | null = null;

/** One shared /api/spot/listings request for every consumer (search, watchlist), refreshed at most every minute. */
export function loadSpotListings() {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    // Same URL and credentials mode as the pages' `preload`, so the first read reuses that in-flight response.
    const promise = fetch(SPOT_LISTINGS_PATH)
      .then((response) => (response.ok ? (response.json() as Promise<{ listings: SpotListing[] }>) : { listings: [] }))
      .then((body) => (Array.isArray(body.listings) ? body.listings : []));
    cache = { at: Date.now(), promise };
    promise.catch(() => (cache = null));
  }
  return cache.promise;
}

/** Every spot pair of the integrated venues; null until loaded (or while `enabled` is false). */
export function useSpotListings(enabled = true) {
  const [listings, setListings] = useState<SpotListing[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let isActive = true;
    const read = () =>
      void loadSpotListings()
        .then((next) => isActive && setListings(next))
        .catch(() => isActive && setListings((current) => current ?? []));
    read();
    const timer = window.setInterval(read, TTL_MS);
    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return listings;
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
