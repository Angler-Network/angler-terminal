import "server-only";
import { unstable_cache } from "next/cache";
import { readExtendedConfig } from "./config";
import { readExtendedFunding, type ExtendedMarketRow } from "./markets";

/**
 * Extended's market list (about 1 MB with every market's risk tiers), trimmed to what the terminal reads and cached 30s
 * for every visitor: the markets route and the funding table read it from here. Public data (open to US servers too).
 */

const trim = (row: Record<string, unknown>): ExtendedMarketRow => {
  const stats = (row.marketStats ?? {}) as Record<string, unknown>;
  const config = (row.tradingConfig ?? {}) as Record<string, unknown>;
  const l2 = (row.l2Config ?? {}) as Record<string, unknown>;
  const pick = (source: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]]])));
  return {
    name: String(row.name ?? ""),
    assetName: String(row.assetName ?? ""),
    category: typeof row.category === "string" ? row.category : undefined,
    type: typeof row.type === "string" ? row.type : undefined,
    status: typeof row.status === "string" ? row.status : undefined,
    active: row.active !== false,
    marketStats: pick(stats, ["dailyVolume", "dailyPriceChangePercentage", "lastPrice", "askPrice", "bidPrice", "markPrice", "fundingRate", "openInterest"]),
    tradingConfig: pick(config, ["minOrderSize", "minOrderSizeChange", "minPriceChange", "maxLeverage", "limitPriceCap", "limitPriceFloor", "maxMarketOrderValue", "maxPositionValue"]),
    l2Config: pick(l2, ["syntheticId", "syntheticResolution", "collateralId", "collateralResolution"]) as ExtendedMarketRow["l2Config"],
  };
};

export const getExtendedMarkets = unstable_cache(
  async (network: "mainnet" | "testnet") => {
    const config = readExtendedConfig({ NEXT_PUBLIC_EXTENDED_NETWORK: network }, null);
    const response = await fetch(`${config.host}/api/v1/info/markets`, { headers: { "user-agent": "AnglerTerminal/1.0", accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Extended markets answered ${response.status}`);
    const rows = (((await response.json()) as { data?: Array<Record<string, unknown>> }).data ?? []).filter((row) => row.type === "PERPETUAL" && row.status === "ACTIVE");
    if (rows.length === 0) throw new Error("Extended listed no markets");
    return rows.map(trim);
  },
  ["extended-markets-v1"],
  { revalidate: 30 },
);


/** Extended's funding for the cross-venue table: hourly rates × 8, mainnet only. */
export async function extendedFundingRows() {
  return readExtendedFunding(await getExtendedMarkets("mainnet")).map((row) => ({ exchange: "extended", symbol: row.symbol, rate: row.hourly * 8 }));
}
