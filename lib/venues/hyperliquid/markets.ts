import type { VenueMarket } from "../types";

/** The parts of `meta` / `metaAndAssetCtxs` the terminal reads. */
export interface PerpMetaLike {
  universe: Array<{ name: string; szDecimals: number; maxLeverage: number; onlyIsolated?: boolean; isDelisted?: boolean }>;
}

export interface AssetCtxLike {
  markPx?: string | null;
  midPx?: string | null;
}

/** `perpDexs` returns null for the main dex at index 0, then builder-deployed (HIP-3) dexs. */
export type PerpDexsLike = Array<{ name: string } | null>;

const SPOT_OFFSET = 10_000;
const HIP3_BASE = 100_000;
const HIP3_DEX_STRIDE = 10_000;

/**
 * Asset ids: main-dex perps use their index in `meta.universe`; HIP-3 perps use
 * 100000 + dexIndex * 10000 + index, where dexIndex is the dex's position in `perpDexs`.
 */
export function perpAssetId(dexIndex: number, index: number) {
  return dexIndex === 0 ? index : HIP3_BASE + dexIndex * HIP3_DEX_STRIDE + index;
}

export function spotAssetId(index: number) {
  return SPOT_OFFSET + index;
}

/** HIP-3 coins are named "dex:COIN" (e.g. "xyz:NVDA"); main-dex coins are bare. */
export function splitCoin(coin: string) {
  const separator = coin.indexOf(":");
  return separator === -1 ? { dex: "", symbol: coin } : { dex: coin.slice(0, separator), symbol: coin.slice(separator + 1) };
}

function toNumber(value: string | null | undefined) {
  const number = Number(value);
  return value != null && Number.isFinite(number) && number > 0 ? number : undefined;
}

/** Builds markets for one perp dex from its meta (and optional asset contexts, same order as the universe). */
export function marketsFromMeta(dexIndex: number, dexName: string, meta: PerpMetaLike, ctxs: AssetCtxLike[] = []) {
  return meta.universe.flatMap((asset, index): VenueMarket[] => {
    if (asset.isDelisted) return [];
    const { symbol } = splitCoin(asset.name);
    return [
      {
        venue: "hyperliquid",
        coin: asset.name,
        symbol,
        dex: dexName,
        assetId: perpAssetId(dexIndex, index),
        szDecimals: asset.szDecimals,
        maxLeverage: asset.maxLeverage,
        // HIP-3 dexs are where Hyperliquid lists equities and other non-crypto perps.
        kind: dexIndex === 0 ? "crypto" : "stock",
        onlyIsolated: Boolean(asset.onlyIsolated),
        markPx: toNumber(ctxs[index]?.markPx),
        midPx: toNumber(ctxs[index]?.midPx),
      },
    ];
  });
}

/**
 * HIP-3 dexs with their index in the full `perpDexs` list (the index drives asset ids, so filter after indexing).
 * Pass `allowed` to keep only those names.
 */
export function builderDexes(perpDexs: PerpDexsLike, allowed?: string[]) {
  return perpDexs.flatMap((dex, index) =>
    index > 0 && dex?.name && (!allowed || allowed.includes(dex.name)) ? [{ name: dex.name, index }] : [],
  );
}

/**
 * Picks the market for a terminal symbol. A coin name ("xyz:NVDA") matches exactly; a bare symbol prefers the
 * main dex, then the first HIP-3 dex that lists it.
 */
export function findMarket(markets: VenueMarket[], symbol: string) {
  const wanted = symbol.toUpperCase();
  const exact = markets.find((market) => market.coin.toUpperCase() === wanted);
  if (exact) return exact;
  const matches = markets.filter((market) => market.symbol.toUpperCase() === wanted);
  return matches.find((market) => market.dex === "") ?? matches[0] ?? null;
}
