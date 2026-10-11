import "server-only";
import { unstable_cache } from "next/cache";
import { qfexConfig } from "./config";
import { readQfexFunding, type QfexContractRow, type QfexRefdataRow } from "./markets";

/**
 * QFEX's reference data and contract stats, trimmed to what the terminal reads and cached 30s for every visitor: the
 * markets route and the funding table read them from here. Public data.
 */

const TIMEOUT_MS = 10_000;

async function json(path: string) {
  const response = await fetch(`${qfexConfig.api}${path}`, { headers: { accept: "application/json", "user-agent": "AnglerTerminal/1.0" }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`QFEX ${path} answered ${response.status}`);
  return ((await response.json()) as { data?: unknown }).data;
}

const pick = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.flatMap((key) => (row[key] === undefined ? [] : [[key, row[key]]])));

export const getQfexMarkets = unstable_cache(
  async () => {
    const [refdata, contracts] = await Promise.all([json("/refdata"), json("/md/contracts")]);
    if (!Array.isArray(refdata) || refdata.length === 0) throw new Error("QFEX listed no markets");
    return {
      refdata: (refdata as Array<Record<string, unknown>>)
        .filter((row) => row.quote_asset === "USD" && row.status === "ACTIVE")
        .map(
          (row) =>
            pick(row, ["symbol", "base_asset", "quote_asset", "status", "product_category", "tick_size", "lot_size", "min_quantity", "max_quantity", "min_price", "max_price", "default_max_leverage", "price_change_24h"]) as unknown as QfexRefdataRow,
        ),
      contracts: (Array.isArray(contracts) ? (contracts as Array<Record<string, unknown>>) : []).map(
        (row) => pick(row, ["ticker_id", "last_price", "index_price", "target_volume", "open_interest_usd", "funding_rate"]) as unknown as QfexContractRow,
      ),
    };
  },
  ["qfex-markets-v1"],
  { revalidate: 30 },
);

/** QFEX's funding for the cross-venue table: hourly × 8 (0 outside each market's funding hours). */
export async function qfexFundingRows() {
  const { refdata, contracts } = await getQfexMarkets();
  return readQfexFunding(refdata, contracts).map((row) => ({ exchange: "qfex", symbol: row.symbol, rate: row.hourly * 8 }));
}
