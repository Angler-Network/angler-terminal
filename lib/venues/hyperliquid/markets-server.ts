import "server-only";
import { HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { unstable_cache } from "next/cache";
import type { VenueMarket } from "../types";
import { hlConfig, type HlNetwork } from "./config";
import { builderDexes, marketsFromMeta } from "./markets";

const REVALIDATE_SECONDS = 60;

/** Main-dex perps plus every HIP-3 dex, from the Info API (perpDexs + metaAndAssetCtxs per dex). */
async function loadMarkets(network: HlNetwork): Promise<VenueMarket[]> {
  const info = new InfoClient({ transport: new HttpTransport({ isTestnet: network === "testnet", timeout: 10_000 }) });
  const [main, perpDexs] = await Promise.all([info.metaAndAssetCtxs(), info.perpDexs()]);
  const hip3 = await Promise.allSettled(
    builderDexes(perpDexs, hlConfig.hip3Dexes).map(async (dex) => {
      const [meta, ctxs] = await info.metaAndAssetCtxs({ dex: dex.name });
      return marketsFromMeta(dex.index, dex.name, meta, ctxs);
    }),
  );
  return [
    ...marketsFromMeta(0, "", main[0], main[1]),
    ...hip3.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
  ];
}

/** Cached per network for a minute so page loads don't each spend Info API weight. */
export const getHlMarkets = unstable_cache(loadMarkets, ["hl-markets-v1"], { revalidate: REVALIDATE_SECONDS });

export function getConfiguredHlMarkets() {
  return getHlMarkets(hlConfig.network);
}
