"use client";

import { useEffect, useState } from "react";
import { readFundingRates, type FundingTable } from "@/lib/trading/funding";

const REFRESH_MS = 60_000;

let shared: { at: number; promise: Promise<FundingTable> } | null = null;

function loadFunding() {
  if (shared && Date.now() - shared.at < REFRESH_MS) return shared.promise;
  const promise = fetch("/api/funding")
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`Funding ${response.status}`))))
    .then(readFundingRates);
  shared = { at: Date.now(), promise };
  promise.catch(() => (shared = null));
  return promise;
}

/** Mainnet funding per symbol and venue (8-hour rates), refreshed every minute; null until loaded. */
export function useFunding() {
  const [table, setTable] = useState<FundingTable | null>(null);
  useEffect(() => {
    let isActive = true;
    const load = () => loadFunding().then((next) => isActive && setTable(next)).catch(() => {});
    void load();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void load(), REFRESH_MS);
    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, []);
  return table;
}
