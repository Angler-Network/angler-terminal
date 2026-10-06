import { lighterPnlSeries, type LighterTrade, type PnlPoint } from "@/lib/trading/portfolio-history";
import { lighterGet } from "./api";

const DAY_MS = 86_400_000;
const TRADES_PAGE = 100;
/** Enough for a month of active manual trading without hammering the API. */
const MAX_TRADE_PAGES = 10;

export interface LighterHistory {
  pnl: PnlPoint[];
  trades: LighterTrade[];
  /** The page cap was hit before reaching the window start: older trades are missing. */
  truncated: boolean;
}

/** Account trades newest first back to `since`, following the cursor. */
async function tradesSince(accountIndex: number, since: number) {
  const trades: LighterTrade[] = [];
  let cursor: string | undefined;
  let truncated = true;
  for (let page = 0; page < MAX_TRADE_PAGES; page += 1) {
    const body = await lighterGet("trades", {
      account_index: accountIndex,
      market_type: "perp",
      sort_by: "timestamp",
      sort_dir: "desc",
      limit: TRADES_PAGE,
      ...(cursor ? { cursor } : {}),
    });
    const batch = Array.isArray(body.trades) ? (body.trades as LighterTrade[]) : [];
    trades.push(...batch.filter((trade) => trade.timestamp >= since));
    cursor = typeof body.next_cursor === "string" ? body.next_cursor : undefined;
    if (!cursor || batch.length < TRADES_PAGE || (batch.at(-1)?.timestamp ?? 0) < since) {
      truncated = false;
      break;
    }
  }
  return { trades, truncated };
}

/** Daily cumulative trade PnL and perp trades since `since` (both public for the account index). */
export async function lighterHistory(accountIndex: number, since: number): Promise<LighterHistory> {
  const now = Date.now();
  const days = Math.ceil((now - since) / DAY_MS) + 1;
  const [pnl, trades] = await Promise.all([
    lighterGet("pnl", {
      by: "index",
      value: accountIndex,
      resolution: "1d",
      // One day earlier so the window has a starting point to measure from.
      start_timestamp: since - DAY_MS,
      end_timestamp: now,
      count_back: days + 1,
    }),
    tradesSince(accountIndex, since).catch(() => ({ trades: [], truncated: false })),
  ]);
  const entries = Array.isArray(pnl.pnl) ? (pnl.pnl as Array<{ timestamp: number; trade_pnl: number }>) : [];
  return { pnl: lighterPnlSeries(entries, since - DAY_MS), ...trades };
}
