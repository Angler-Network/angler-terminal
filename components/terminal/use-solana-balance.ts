"use client";

import { useEffect, useState } from "react";
import { readSolanaBalances } from "@/lib/venues/jupiter/balance-cache";
import { WSOL_MINT } from "@/lib/venues/jupiter/config";

const BALANCE_REFRESH_MS = 15_000;
/** SOL kept back for fees when spending native SOL. */
export const SOL_RESERVE_LAMPORTS = 10_000_000n;

/** The wallet's spendable balance of a Solana token (native SOL less a fee reserve), refreshed while visible. */
export function useSolanaBalance(owner: string | null, mint: string | null, refresh: number) {
  const key = owner && mint ? `${owner}:${mint}:${refresh}` : null;
  const [state, setState] = useState<{ key: string; amount: bigint } | null>(null);
  useEffect(() => {
    if (!key || !owner || !mint) return;
    let active = true;
    const load = async () => {
      try {
        const body = await readSolanaBalances(owner, mint === WSOL_MINT ? [] : [mint]);
        const lamports = BigInt(body.lamports);
        const amount = mint === WSOL_MINT ? (lamports > SOL_RESERVE_LAMPORTS ? lamports - SOL_RESERVE_LAMPORTS : 0n) : BigInt(body.tokens?.[mint] ?? "0");
        if (active) setState({ key, amount });
      } catch {}
    };
    void load();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void load(), BALANCE_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key covers the wallet, mint and refreshes
  }, [key]);
  return key && state?.key === key ? state.amount : undefined;
}
