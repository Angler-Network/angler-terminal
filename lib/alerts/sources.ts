import "server-only";
import { anglerConfig } from "@/lib/angler/env";
import { venueAvailable } from "@/lib/deployment";
import { getAsterMarkets } from "@/lib/venues/aster/markets-server";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import { lighterConfig, lighterRhConfig, type LighterConfig } from "@/lib/venues/lighter/config";
import type { VenueMarket } from "@/lib/venues/types";
import { getLighterMarkets } from "@/lib/venues/lighter/markets-server";
import { readAccountIndex, readPosition } from "@/lib/venues/lighter/account";
import { mergeAlertCoins, type AlertCoin, type PriceMarket } from "./coins";
import type { AlertNews, AlertVenue, PositionSnap } from "./rules";

/**
 * What the alerts tick reads, all public (no user keys): Hyperliquid mids and positions by address, Lighter positions
 * by account index, and the latest Angler news. Network follows the deployment like the rest of the server.
 */

const TIMEOUT_MS = 8_000;

async function hlInfo<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${hlConfig.apiUrl}/info`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Hyperliquid answered ${response.status}.`);
  return (await response.json()) as T;
}

/** The dexes alerts look at: the main one ("") and the HIP-3 dexes the terminal lists. */
const HL_DEXES = ["", ...hlConfig.hip3Dexes];

/** Mid prices by coin across the main and HIP-3 dexes ("BTC", "xyz:NVDA"). */
export async function hlMids(): Promise<Record<string, number>> {
  const results = await Promise.allSettled(HL_DEXES.map((dex) => hlInfo<Record<string, string>>(dex ? { type: "allMids", dex } : { type: "allMids" })));
  const mids: Record<string, number> = {};
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const [coin, value] of Object.entries(result.value)) {
      const mid = Number(value);
      if (mid > 0 && !coin.startsWith("@")) mids[coin] = mid;
    }
  }
  return mids;
}

const priceMarkets = (markets: VenueMarket[], prefer: "mid" | "mark"): PriceMarket[] =>
  markets.map((market) => ({ symbol: market.symbol, price: prefer === "mid" ? (market.midPx ?? market.markPx) : (market.markPx ?? market.midPx), stock: market.kind === "stock" }));

/**
 * Everything price alerts can watch: Hyperliquid's mids, then the markets only Lighter, Lighter RH or Aster list (each
 * on the deployment's network; Aster only where it's offered). A venue that fails is skipped for this read; all failing
 * throws, so a cached list is never replaced by an empty one.
 */
export async function alertCoins(): Promise<AlertCoin[]> {
  const [hl, lighter, lighterRh, aster] = await Promise.allSettled([
    hlMids(),
    venueAvailable("lighter") ? getLighterMarkets(lighterConfig.network, "core") : Promise.resolve([]),
    venueAvailable("lighterRh") ? getLighterMarkets(lighterRhConfig.network, "rh") : Promise.resolve([]),
    venueAvailable("aster") ? getAsterMarkets() : Promise.resolve([]),
  ]);
  const value = <T,>(result: PromiseSettledResult<T>, fallback: T) => (result.status === "fulfilled" ? result.value : fallback);
  const coins = mergeAlertCoins(value(hl, {}), [
    { venue: "lighter", markets: priceMarkets(value(lighter, []), "mid") },
    { venue: "lighterrh", markets: priceMarkets(value(lighterRh, []), "mid") },
    { venue: "aster", markets: priceMarkets(value(aster, []), "mark") },
  ]);
  if (coins.length === 0) throw new Error("No venue sent prices.");
  return coins;
}

type HlState = {
  assetPositions?: Array<{
    position: { coin: string; szi: string; entryPx: string; positionValue: string; unrealizedPnl: string; liquidationPx: string | null };
  }>;
};

export function readHlPositions(state: HlState): PositionSnap[] {
  return (state.assetPositions ?? []).flatMap(({ position }) => {
    const size = Number(position.szi);
    if (!size) return [];
    const liquidation = Number(position.liquidationPx);
    return [
      {
        venue: "hyperliquid" as const,
        coin: position.coin,
        size,
        entryPx: Number(position.entryPx),
        markPx: Math.abs(Number(position.positionValue) / size),
        liquidationPx: liquidation > 0 ? liquidation : null,
        unrealizedPnl: Number(position.unrealizedPnl),
      },
    ];
  });
}

/** Open Hyperliquid positions of an address on every watched dex. Throws when a dex can't be read. */
export async function hlPositions(address: string): Promise<PositionSnap[]> {
  const states = await Promise.all(HL_DEXES.map((dex) => hlInfo<HlState>(dex ? { type: "clearinghouseState", user: address, dex } : { type: "clearinghouseState", user: address })));
  return states.flatMap(readHlPositions);
}

async function lighterGet(config: LighterConfig, path: string, params: Record<string, string>) {
  const response = await fetch(`${config.apiUrl}/api/v1/${path}?${new URLSearchParams(params)}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok && response.status !== 400 && response.status !== 404) throw new Error(`${config.name} answered ${response.status}.`);
  return (await response.json()) as Record<string, unknown>;
}

/** The address's Lighter account index, or null when it has none yet. */
export async function lighterAccountIndex(config: LighterConfig, address: string) {
  return readAccountIndex(await lighterGet(config, "accountsByL1Address", { l1_address: address }));
}

/** Open positions of a Lighter account. */
export async function lighterPositions(config: LighterConfig, accountIndex: number): Promise<PositionSnap[]> {
  const body = await lighterGet(config, "account", { by: "index", value: String(accountIndex) });
  const account = Array.isArray(body.accounts) ? (body.accounts[0] as Record<string, unknown> | undefined) : undefined;
  const positions = Array.isArray(account?.positions) ? account.positions : [];
  return positions.flatMap((value) => {
    const position = readPosition(value);
    if (!position) return [];
    return [
      {
        venue: config.venue as AlertVenue,
        coin: position.coin,
        size: position.size,
        entryPx: position.entryPx,
        markPx: position.positionValue / Math.abs(position.size),
        liquidationPx: position.liquidationPx,
        unrealizedPnl: position.unrealizedPnl,
      },
    ];
  });
}

type ApiItem = { id?: unknown; title?: unknown; importance_score?: unknown; coins?: unknown; url?: unknown; translations?: Record<string, { title?: unknown } | null> | null };

/** The latest news at or above `minImpact`, newest first (one page). Empty without an API key. */
export async function latestNews(minImpact: number): Promise<AlertNews[]> {
  const { apiUrl, key } = anglerConfig();
  if (!key) return [];
  const response = await fetch(`${apiUrl}/v1/news?min_importance=${minImpact}&limit=50`, {
    headers: { authorization: `Bearer ${key}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Angler API answered ${response.status}.`);
  const body = (await response.json()) as { items?: ApiItem[] };
  return (body.items ?? []).flatMap((item) => {
    const id = Number(item.id);
    const english = item.translations?.en?.title;
    const title = typeof english === "string" && english ? english : typeof item.title === "string" ? item.title : "";
    if (!Number.isSafeInteger(id) || !title) return [];
    return [
      {
        id,
        title,
        impact: Number(item.importance_score) || 0,
        coins: Array.isArray(item.coins) ? item.coins.filter((coin): coin is string => typeof coin === "string").map((coin) => coin.toUpperCase()) : [],
        url: typeof item.url === "string" && /^https?:\/\//.test(item.url) ? item.url : undefined,
      },
    ];
  });
}
