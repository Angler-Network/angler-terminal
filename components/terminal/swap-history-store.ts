"use client";

import { useEffect, useState } from "react";
import { addSwap, readSwapHistory, swapHistoryKey, type SwapRecord } from "@/lib/spot/swap-history";

const EVENT = "angler:swap-history";

function load(wallet: string) {
  try {
    return readSwapHistory(localStorage.getItem(swapHistoryKey(wallet)));
  } catch {
    return [];
  }
}

/** Saves a swap the terminal made for this wallet (a blocked storage only loses the record, never the swap). */
export function recordSwap(wallet: string, record: SwapRecord) {
  try {
    localStorage.setItem(swapHistoryKey(wallet), JSON.stringify(addSwap(load(wallet), record)));
    window.dispatchEvent(new CustomEvent(EVENT, { detail: wallet }));
  } catch {}
}

/** The swaps recorded for these wallets (Solana and EVM), newest first, live as new ones are saved. */
export function useSwapHistory(wallets: Array<string | null | undefined>) {
  const key = wallets.filter(Boolean).join(",");
  const [history, setHistory] = useState<SwapRecord[]>([]);
  useEffect(() => {
    const list = key ? key.split(",") : [];
    const refresh = () => setHistory(list.flatMap(load).sort((a, b) => b.at - a.at));
    refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [key]);
  return history;
}
