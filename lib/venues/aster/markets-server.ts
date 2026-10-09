import "server-only";
import { unstable_cache } from "next/cache";
import type { VenueMarket } from "../types";
import { ASTER_API_URL } from "./config";
import { readAsterMarkets } from "./markets";

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${ASTER_API_URL}${path}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Aster answered ${response.status}`);
  return (await response.json()) as T;
}

/** Aster's perp markets (exchange info, 24h tickers, mark prices); throws on an empty list so the cache keeps the last. */
async function loadMarkets(): Promise<VenueMarket[]> {
  const [info, tickers, premium] = await Promise.all([
    get<{ symbols?: unknown[] }>("/fapi/v1/exchangeInfo"),
    get<unknown[]>("/fapi/v1/ticker/24hr"),
    get<unknown[]>("/fapi/v1/premiumIndex"),
  ]);
  const markets = readAsterMarkets(
    (info.symbols ?? []) as Parameters<typeof readAsterMarkets>[0],
    (Array.isArray(tickers) ? tickers : []) as Parameters<typeof readAsterMarkets>[1],
    (Array.isArray(premium) ? premium : []) as Parameters<typeof readAsterMarkets>[2],
  );
  if (markets.length === 0) throw new Error("Aster listed no markets");
  return markets;
}

/** Shared by `/api/aster/markets` and the alerts tick: one fetch every 30 seconds for everyone. */
export const getAsterMarkets = unstable_cache(loadMarkets, ["aster-markets-v1"], { revalidate: 30 });
