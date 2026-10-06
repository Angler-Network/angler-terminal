import "server-only";
import { unstable_cache } from "next/cache";
import type { VenueMarket } from "../types";
import { readLighterConfig, type LighterNetwork } from "./config";
import { readOrderBookDetails } from "./markets";

const REVALIDATE_SECONDS = 60;
const TIMEOUT_MS = 10_000;

/** Perp markets from `GET /api/v1/orderBookDetails` (ids, decimals, minimums, prices). */
async function loadMarkets(network: LighterNetwork): Promise<VenueMarket[]> {
  const { apiUrl } = readLighterConfig({ NEXT_PUBLIC_LIGHTER_NETWORK: network });
  const response = await fetch(`${apiUrl}/api/v1/orderBookDetails`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Lighter responded ${response.status}`);
  const markets = readOrderBookDetails(await response.json());
  if (markets.length === 0) throw new Error("Lighter returned no markets");
  return markets;
}

/** Cached per network for a minute: Standard accounts get 60 REST requests a minute, so browsers shouldn't each ask. */
export const getLighterMarkets = unstable_cache(loadMarkets, ["lighter-markets-v2"], { revalidate: REVALIDATE_SECONDS });
