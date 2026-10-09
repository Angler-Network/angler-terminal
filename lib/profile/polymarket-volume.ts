import "server-only";
import { unstable_cache } from "next/cache";
import { polymarketBuilderCode } from "@/lib/venues/polymarket/config";
import { depositWalletCandidates } from "@/lib/venues/polymarket/deposit-wallet";
import { readPolymarketBuilderTrades, polymarketAnglerVolume, type BuilderTradeRow } from "./polymarket-trades";

/**
 * A wallet's Polymarket volume through Angler, from Polymarket's public builder trades (`GET /builder/trades?
 * builder_code=`): every trade an order carrying our builder code made, with the Deposit Wallet that placed it
 * (`maker`). The wallet's Deposit Wallet is derived from its address (`deposit-wallet.ts`), so the browser can't claim
 * another account's trades. Only trades that paid our builder fee count; POLYMARKET_BUILDER_FEE_BPS (the rate set on
 * the builder profile) scales their points, and without it they earn none.
 */

const TIMEOUT_MS = 10_000;
const MAX_PAGES = 20;
const END = "LTE=";

async function loadBuilderTrades(code: string): Promise<BuilderTradeRow[]> {
  const rows: BuilderTradeRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ builder_code: code, ...(cursor ? { next_cursor: cursor } : {}) });
    const response = await fetch(`https://clob.polymarket.com/builder/trades?${query}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Polymarket answered ${response.status}`);
    const body = (await response.json()) as { data?: unknown[]; next_cursor?: string };
    rows.push(...readPolymarketBuilderTrades(body.data ?? []));
    if (!body.next_cursor || body.next_cursor === END || body.next_cursor === cursor) break;
    cursor = body.next_cursor;
  }
  return rows;
}

/** Shared by every profile's sync for a minute: one read of our builder trades, not one per profile. */
const builderTrades = unstable_cache(loadBuilderTrades, ["polymarket-builder-trades-v1"], { revalidate: 60 });

export function polymarketFeeBps(env: Record<string, string | undefined>) {
  const bps = Number(env.POLYMARKET_BUILDER_FEE_BPS);
  return Number.isFinite(bps) && bps > 0 && bps <= 1000 ? bps : null;
}

/** New Polymarket volume of an EVM profile since `cursor` (seconds), or null when there's nothing to count. */
export async function syncPolymarket(address: string, cursor: number | null, inBeta: (time: number) => boolean) {
  const bps = polymarketFeeBps(process.env);
  if (!polymarketBuilderCode || !bps) return null;
  const wallets = new Set(depositWalletCandidates(address as `0x${string}`));
  const result = polymarketAnglerVolume(await builderTrades(polymarketBuilderCode), wallets, cursor, inBeta);
  return result.usd > 0 ? { ...result, bps, fee: (result.usd * bps) / 10_000 } : result.lastTime > (cursor ?? 0) ? { ...result, bps, fee: 0 } : null;
}
