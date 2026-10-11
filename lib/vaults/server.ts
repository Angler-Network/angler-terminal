import "server-only";
import { unstable_cache } from "next/cache";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import { lighterConfig, lighterRhConfig, type LighterConfig } from "@/lib/venues/lighter/config";
import { orderlyConfig } from "@/lib/venues/orderly/config";
import { extendedConfig } from "@/lib/venues/extended/config";
import { EXTENDED_PERIODS, EXTENDED_VAULT_ID, extendedHistory, hlHistory, lighterHistory, lighterNextIndex, orderlyHistory, readExtendedVault, readHlVaults, readLighterPools, readOrderlyVaults } from "./parse";
import type { VaultHistory, VaultRow, VaultVenue } from "./types";

/**
 * Vault lists and histories, fetched on the server and cached: Hyperliquid's list is ~14 MB (every vault ever made), so
 * only the filtered rows are kept (unstable_cache items must stay under 2 MB). Each venue has its own cache entry, so
 * one venue failing keeps its last good list and never blanks the others.
 */

const LIST_SECONDS = 15 * 60;
const HISTORY_SECONDS = 5 * 60;
const TIMEOUT_MS = 30_000;
/** Lighter pages hold 100 pools; mainnet had 338 in October 2026. */
const LIGHTER_MAX_PAGES = 10;
const LIGHTER_FIRST_INDEX = 281474976710655;
const HISTORY_DAYS = 365;

const HL_STATS = { mainnet: "https://stats-data.hyperliquid.xyz/Mainnet/vaults", testnet: "https://stats-data.hyperliquid.xyz/Testnet/vaults" };
const HL_APP = { mainnet: "https://app.hyperliquid.xyz", testnet: "https://app.hyperliquid-testnet.xyz" };
const ORDERLY_VAULT_API = { mainnet: "https://api-sv.orderly.org", testnet: "https://testnet-api-sv.orderly.org" };
const ORDERLY_VAULT_APP = { mainnet: "https://app.orderly.network/vaults", testnet: "https://testnet-dex.orderly.network" };

async function json(url: string, init?: RequestInit): Promise<unknown> {
  // no-store: the raw answers are big (HL's list) and only the parsed rows are cached.
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response.json();
}

async function loadHl(): Promise<VaultRow[]> {
  const rows = readHlVaults(await json(HL_STATS[hlConfig.network]), HL_APP[hlConfig.network]);
  if (rows.length === 0) throw new Error("Hyperliquid listed no vaults");
  return rows;
}

async function loadLighter(config: LighterConfig, venue: Extract<VaultVenue, "lighter" | "lighterRh">): Promise<VaultRow[]> {
  const rows: VaultRow[] = [];
  let index: number | null = LIGHTER_FIRST_INDEX;
  for (let page = 0; page < LIGHTER_MAX_PAGES && index !== null; page += 1) {
    const raw = await json(`${config.apiUrl}/api/v1/publicPoolsMetadata?filter=all&index=${index}&limit=100`);
    rows.push(...readLighterPools(raw, venue, config.appUrl));
    const next = lighterNextIndex(raw);
    index = next !== null && next < index ? next : null;
  }
  return rows;
}

async function loadOrderly(): Promise<VaultRow[]> {
  return readOrderlyVaults(await json(`${ORDERLY_VAULT_API[orderlyConfig.network]}/v1/public/strategy_vault/vault/info`), ORDERLY_VAULT_APP[orderlyConfig.network]);
}

const EXTENDED_HEADERS = { "user-agent": "AnglerTerminal/1.0", accept: "application/json" };

async function loadExtended(): Promise<VaultRow[]> {
  // Extended's API refuses requests without a user agent.
  const rows = readExtendedVault(await json(`${extendedConfig.host}/api/v1/vault/public/summary`, { headers: EXTENDED_HEADERS }), extendedConfig.app);
  if (rows.length === 0) throw new Error("Extended sent no vault");
  return rows;
}

const keyFor = (venue: string, network: string) => [`vaults-v1-${venue}-${network}`];
const cachedHl = unstable_cache(loadHl, keyFor("hyperliquid", hlConfig.network), { revalidate: LIST_SECONDS });
const cachedLighter = unstable_cache(() => loadLighter(lighterConfig, "lighter"), keyFor("lighter", lighterConfig.network), { revalidate: LIST_SECONDS });
const cachedLighterRh = unstable_cache(() => loadLighter(lighterRhConfig, "lighterRh"), keyFor("lighterRh", lighterRhConfig.network), { revalidate: LIST_SECONDS });
const cachedOrderly = unstable_cache(loadOrderly, keyFor("orderly", orderlyConfig.network), { revalidate: LIST_SECONDS });
const cachedExtended = unstable_cache(loadExtended, keyFor("extended", extendedConfig.network), { revalidate: LIST_SECONDS });

/** Every venue's open vaults, biggest first; `failed` names the venues that couldn't be read (with no list cached). */
export async function getVaults(): Promise<{ vaults: VaultRow[]; failed: VaultVenue[] }> {
  const sources: Array<[VaultVenue, () => Promise<VaultRow[]>]> = [
    ["hyperliquid", cachedHl],
    ["lighter", cachedLighter],
    ["lighterRh", cachedLighterRh],
    ["orderly", cachedOrderly],
    ["extended", cachedExtended],
  ];
  const results = await Promise.allSettled(sources.map(([, load]) => load()));
  const failed: VaultVenue[] = [];
  const vaults = results.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value;
    console.warn(`[vaults] ${sources[index][0]} failed: ${String(result.reason)}`);
    failed.push(sources[index][0]);
    return [];
  });
  return { vaults: vaults.sort((a, b) => b.tvl - a.tvl), failed };
}

/** Ids each venue uses: HL address, Lighter account index, Orderly vault id, "xvs" for Extended's one vault. */
export function validVaultId(venue: VaultVenue, id: string) {
  if (venue === "hyperliquid") return /^0x[0-9a-f]{40}$/.test(id);
  if (venue === "orderly") return /^0x[0-9a-f]{64}$/.test(id);
  if (venue === "extended") return id === EXTENDED_VAULT_ID;
  return /^\d{1,20}$/.test(id);
}

async function loadHistory(venue: VaultVenue, id: string): Promise<VaultHistory> {
  if (venue === "hyperliquid") {
    return hlHistory(await json(`${hlConfig.apiUrl}/info`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "vaultDetails", vaultAddress: id }) }));
  }
  if (venue === "extended") {
    const answers = await Promise.all(EXTENDED_PERIODS.map(([interval]) => json(`${extendedConfig.host}/api/v1/vault/public/performance?interval=${interval}`, { headers: EXTENDED_HEADERS })));
    return extendedHistory(Object.fromEntries(EXTENDED_PERIODS.map(([interval], index) => [interval, answers[index]])));
  }
  if (venue === "orderly") return orderlyHistory(await json(`${ORDERLY_VAULT_API[orderlyConfig.network]}/v1/public/strategy_vault/vault/performance?vault_id=${id}`));
  const config = venue === "lighter" ? lighterConfig : lighterRhConfig;
  const end = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({ by: "index", value: id, resolution: "1d", start_timestamp: String(end - HISTORY_DAYS * 86_400), end_timestamp: String(end), count_back: String(HISTORY_DAYS) });
  return lighterHistory(await json(`${config.apiUrl}/api/v1/pnl?${params}`));
}

/** One vault's performance, cached a few minutes per vault. */
export function getVaultHistory(venue: VaultVenue, id: string) {
  return unstable_cache(() => loadHistory(venue, id), ["vault-history-v1", venue, id], { revalidate: HISTORY_SECONDS })();
}
