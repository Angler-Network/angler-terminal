"use client";

import { TRADE_EVENT } from "@/lib/profile/client";

/**
 * The Solana wallet's balances, shared by everything that shows them: the account panel, the swap card and the pay
 * token picker each polled `/api/solana/balances` on their own, two or three RPC calls apiece, for the same wallet and
 * tokens. Answers for the same owner and mints are reused for FRESH_MS and requests in flight are shared; a trade
 * clears them so the next read shows the new balances.
 */

export interface SolanaBalancesBody {
  lamports: string;
  tokens: Record<string, string>;
}

const FRESH_MS = 10_000;
/** After a trade the server's own short cache is skipped too for a while, so the new balances show at once. */
const AFTER_TRADE_MS = 30_000;
let tradedAt = 0;
const entries = new Map<string, { at: number; body: Promise<SolanaBalancesBody> }>();
let listening = false;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener(TRADE_EVENT, () => {
    entries.clear();
    tradedAt = Date.now();
  });
}

/** Raw balances of `owner` (lamports and each mint's base units); `fresh` skips the shared copy (right before a trade). */
export function readSolanaBalances(owner: string, mints: string[], { fresh = false }: { fresh?: boolean } = {}): Promise<SolanaBalancesBody> {
  listen();
  const sorted = [...new Set(mints.filter(Boolean))].sort();
  const key = `${owner}|${sorted.join(",")}`;
  const hit = entries.get(key);
  if (!fresh && hit && Date.now() - hit.at < FRESH_MS) return hit.body;
  const body = (async () => {
    const params = new URLSearchParams({ owner, mints: sorted.join(",") });
    if (fresh || Date.now() - tradedAt < AFTER_TRADE_MS) params.set("fresh", "1");
    const response = await fetch(`/api/solana/balances?${params}`, { cache: "no-store" });
    const json = (await response.json().catch(() => ({}))) as Partial<SolanaBalancesBody> & { error?: string };
    if (!response.ok || json.lamports === undefined) throw new Error(json.error ?? "Couldn't load balances.");
    return { lamports: json.lamports, tokens: json.tokens ?? {} };
  })();
  entries.set(key, { at: Date.now(), body });
  body.catch(() => entries.delete(key));
  return body;
}
