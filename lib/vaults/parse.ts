import type { VaultHistory, VaultRow, VaultVenue } from "./types";

/**
 * Venue answers → `VaultRow` / `VaultHistory`. Pure, tested against real samples in `fixtures/`.
 * - Hyperliquid: `stats-data.hyperliquid.xyz/{Mainnet|Testnet}/vaults` (every vault, ~14 MB) and `vaultDetails`.
 * - Lighter / Lighter RH: `publicPoolsMetadata` pages and the public `pnl` chart of a pool's account.
 * - Orderly: `api-sv.orderly.org/v1/public/strategy_vault/vault/info` and `.../vault/performance`.
 */

/** Vaults below this are left out of the list (thousands of empty HL vaults). */
export const MIN_LISTED_TVL = 1_000;
const DAY_MS = 86_400_000;

const num = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

// --- Hyperliquid

interface HlVaultEntry {
  apr?: unknown;
  summary?: {
    name?: unknown;
    vaultAddress?: unknown;
    leader?: unknown;
    tvl?: unknown;
    isClosed?: unknown;
    relationship?: { type?: unknown };
    createTimeMillis?: unknown;
  };
}

const HL_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** HLP locks deposits for 4 days, user vaults for 1 (Hyperliquid docs); leaders keep 10% of profits, HLP none. */
const HL_LOCK_HOURS = { protocol: 96, user: 24 };
const HL_LEADER_SHARE = 0.1;

/** Open vaults from Hyperliquid's list; HLP's child vaults are left out (they're part of HLP). */
export function readHlVaults(raw: unknown, appUrl: string): VaultRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: HlVaultEntry) => {
    const summary = entry?.summary;
    const id = summary?.vaultAddress;
    const tvl = num(summary?.tvl);
    const relation = summary?.relationship?.type;
    if (typeof id !== "string" || !HL_ADDRESS.test(id) || tvl === null || tvl < MIN_LISTED_TVL || summary?.isClosed === true || relation === "child") return [];
    const kind = relation === "parent" ? "protocol" : "user";
    const row: VaultRow = {
      venue: "hyperliquid",
      id: id.toLowerCase(),
      name: typeof summary?.name === "string" && summary.name.trim() ? summary.name.trim() : "Unnamed vault",
      kind,
      manager: typeof summary?.leader === "string" ? summary.leader.toLowerCase() : null,
      tvl,
      apr: num(entry.apr),
      aprBasis: "APR as Hyperliquid shows it",
      createdAt: num(summary?.createTimeMillis),
      profitShare: kind === "protocol" ? 0 : HL_LEADER_SHARE,
      lockHours: HL_LOCK_HOURS[kind],
      open: true,
      url: `${appUrl}/vaults/${id.toLowerCase()}`,
    };
    return [row];
  });
}

type HlWindow = { accountValueHistory?: unknown; pnlHistory?: unknown };

function hlSteps(window: HlWindow | undefined) {
  const values = Array.isArray(window?.accountValueHistory) ? window.accountValueHistory : [];
  const pnls = Array.isArray(window?.pnlHistory) ? window.pnlHistory : [];
  const points: Array<{ t: number; value: number; pnl: number }> = [];
  for (let index = 0; index < Math.min(values.length, pnls.length); index += 1) {
    const t = num(values[index]?.[0]);
    const value = num(values[index]?.[1]);
    const pnl = num(pnls[index]?.[1]);
    if (t !== null && value !== null && pnl !== null && num(pnls[index]?.[0]) === t) points.push({ t, value, pnl });
  }
  // One step per interval, its return the PnL made over it on the capital at work (Modified Dietz: the value at its
  // start plus half the net deposits during it), so flows in or out don't count as gains. All-time steps run ~2 weeks,
  // and HLP took in ~$90M around its October 2025 windfall: on the start value alone that step read 9.7%, not 8.8%.
  const steps: Array<{ start: number; end: number; ret: number }> = [];
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    const pnl = after.pnl - before.pnl;
    const capital = before.value + (after.value - before.value - pnl) / 2;
    if (capital > 0) steps.push({ start: before.t, end: after.t, ret: pnl / capital });
  }
  return { start: points[0]?.t ?? null, steps };
}

/**
 * Hyperliquid's `vaultDetails.portfolio` has value and PnL histories per window (week, month, all time), each PnL
 * starting at 0. The coarse all-time steps are kept up to where the month starts, then the month's, then the week's.
 */
export function hlHistory(details: unknown, now = Date.now()): VaultHistory {
  const portfolio = (details as { portfolio?: unknown })?.portfolio;
  const windows = new Map<string, HlWindow>(Array.isArray(portfolio) ? portfolio.filter((entry) => Array.isArray(entry) && typeof entry[0] === "string").map((entry) => [entry[0], entry[1]]) : []);
  let steps: Array<{ start: number; end: number; ret: number }> = [];
  for (const name of ["allTime", "month", "week"]) {
    const window = hlSteps(windows.get(name));
    if (window.start === null || window.steps.length === 0) continue;
    steps = [...steps.filter((step) => step.end <= window.start!), ...window.steps];
  }
  const points: Array<[number, number]> = [];
  let index = 1;
  for (const step of steps) {
    if (points.length === 0) points.push([step.start, index]);
    index *= 1 + step.ret;
    points.push([step.end, index]);
  }
  return summarize(points, now);
}

// --- Lighter

interface LighterPool {
  account_index?: unknown;
  created_at?: unknown;
  account_type?: unknown;
  name?: unknown;
  l1_address?: unknown;
  annual_percentage_yield?: unknown;
  sharpe_ratio?: unknown;
  status?: unknown;
  operator_fee?: unknown;
  total_asset_value?: unknown;
  total_shares?: unknown;
}

/** LLP is account type 3 (the protocol's pool); user pools are 2. */
const LIGHTER_PROTOCOL_POOL = 3;
const ZERO_ADDRESS = /^0x0{40}$/i;

/** One page of `publicPoolsMetadata` (`public_pools`), active pools only. */
export function readLighterPools(raw: unknown, venue: Extract<VaultVenue, "lighter" | "lighterRh">, appUrl: string | null): VaultRow[] {
  const pools = (raw as { public_pools?: unknown })?.public_pools;
  if (!Array.isArray(pools)) return [];
  return pools.flatMap((pool: LighterPool) => {
    const index = num(pool.account_index);
    const tvl = num(pool.total_asset_value);
    const shares = num(pool.total_shares);
    if (index === null || tvl === null || tvl < MIN_LISTED_TVL || pool.status !== 0) return [];
    const apy = num(pool.annual_percentage_yield);
    const fee = num(pool.operator_fee);
    const created = num(pool.created_at);
    const kind = pool.account_type === LIGHTER_PROTOCOL_POOL ? "protocol" : "user";
    const manager = typeof pool.l1_address === "string" && !ZERO_ADDRESS.test(pool.l1_address) ? pool.l1_address.toLowerCase() : null;
    const row: VaultRow = {
      venue,
      id: String(index),
      name: typeof pool.name === "string" && pool.name.trim() ? pool.name.trim() : kind === "protocol" ? "Lighter Liquidity Provider (LLP)" : "Unnamed pool",
      kind,
      manager,
      tvl,
      apr: apy === null ? null : apy / 100,
      aprBasis: "APY as Lighter shows it",
      createdAt: created === null ? null : created * 1000,
      profitShare: fee === null ? null : fee / 100,
      lockHours: null,
      open: true,
      sharePrice: shares ? tvl / shares : undefined,
      sharpe: num(pool.sharpe_ratio),
      url: appUrl ? `${appUrl}/public-pools/${index}` : "",
    };
    return [row];
  });
}

/** The smallest account index on a page: the cursor for the next one (pages run down from the largest index). */
export function lighterNextIndex(raw: unknown): number | null {
  const pools = (raw as { public_pools?: Array<{ account_index?: unknown }> })?.public_pools;
  if (!Array.isArray(pools) || pools.length === 0) return null;
  const indexes = pools.map((pool) => num(pool.account_index)).filter((value): value is number => value !== null);
  return indexes.length ? Math.min(...indexes) : null;
}

/**
 * A pool's public daily `pnl` chart: inflow, outflow and trade PnL are running totals, so the pool's value is
 * inflow - outflow + trade PnL (it matches `total_asset_value`), and value / shares is the share price.
 */
export function lighterHistory(raw: unknown, now = Date.now()): VaultHistory {
  const rows = (raw as { pnl?: unknown })?.pnl;
  const points: Array<[number, number]> = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const t = num(row?.timestamp);
    const inflow = num(row?.inflow);
    const outflow = num(row?.outflow);
    const pnl = num(row?.trade_pnl);
    const shares = num(row?.pool_total_shares);
    if (t === null || inflow === null || outflow === null || pnl === null || !shares) continue;
    const value = inflow - outflow + pnl;
    if (value > 0) points.push([t * 1000, value / shares]);
  }
  points.sort((a, b) => a[0] - b[0]);
  const first = points[0]?.[1];
  return summarize(first ? points.map(([t, price]) => [t, price / first]) : [], now);
}

// --- Orderly

interface OrderlyVault {
  vault_id?: unknown;
  vault_type?: unknown;
  vault_name?: unknown;
  sp_name?: unknown;
  status?: unknown;
  vault_start_time?: unknown;
  performance_fee_rate?: unknown;
  tvl?: unknown;
  lock_duration?: unknown;
  min_deposit_amount?: unknown;
  "30d_apy"?: unknown;
}

/** Live strategy vaults from Orderly's vault list. */
export function readOrderlyVaults(raw: unknown, appUrl: string): VaultRow[] {
  const rows = (raw as { data?: { rows?: unknown } })?.data?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((vault: OrderlyVault) => {
    const tvl = num(vault.tvl);
    if (typeof vault.vault_id !== "string" || tvl === null || tvl < MIN_LISTED_TVL || vault.status !== "live") return [];
    const row: VaultRow = {
      venue: "orderly",
      id: vault.vault_id,
      name: typeof vault.vault_name === "string" ? vault.vault_name : "Orderly vault",
      kind: vault.vault_type === "protocol" ? "protocol" : "user",
      manager: typeof vault.sp_name === "string" ? vault.sp_name : null,
      tvl,
      apr: num(vault["30d_apy"]),
      aprBasis: "Orderly's 30-day APY",
      createdAt: num(vault.vault_start_time),
      profitShare: num(vault.performance_fee_rate),
      lockHours: num(vault.lock_duration),
      open: true,
      minDeposit: num(vault.min_deposit_amount),
      url: appUrl,
    };
    return [row];
  });
}

/** Orderly publishes no value history, only its own PnL and drawdown per period (24h, 7d, 30d…). */
export function orderlyHistory(raw: unknown): VaultHistory {
  const rows = (raw as { data?: { rows?: unknown } })?.data?.rows;
  const periods = (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const pnl = num(row?.incremental_net_pnl);
    const drawdown = num(row?.max_drawdown);
    return typeof row?.time_range === "string" && pnl !== null && drawdown !== null ? [{ range: row.time_range, pnl, maxDrawdown: drawdown }] : [];
  });
  // Its all-time drawdown when given, else the largest of the periods.
  const allTime = periods.find((period) => period.range === "all_time") ?? [...periods].sort((a, b) => b.maxDrawdown - a.maxDrawdown)[0];
  return { points: [], returns: { d7: null, d30: null, d90: null, y1: null }, maxDrawdown: allTime?.maxDrawdown ?? null, periods };
}

// --- Shared math

/** The index at or before `time`; null when the history starts more than a day after it. */
function indexAt(points: Array<[number, number]>, time: number) {
  if (points.length === 0 || points[0][0] > time + DAY_MS) return null;
  let found = points[0][1];
  for (const [t, index] of points) {
    if (t > time) break;
    found = index;
  }
  return found;
}

/** Returns over 7, 30, 90 and 365 days and the largest fall from a peak, from an index series (oldest first). */
export function summarize(points: Array<[number, number]>, now = Date.now()): VaultHistory {
  const last = points.at(-1);
  const growth = (days: number) => {
    if (!last) return null;
    const start = indexAt(points, Math.min(now, last[0]) - days * DAY_MS);
    return start ? last[1] / start - 1 : null;
  };
  // The chart and the drawdown cover the last year at most.
  const shown = last ? points.filter(([t]) => t >= last[0] - 365 * DAY_MS) : [];
  let peak = 0;
  let maxDrawdown = 0;
  for (const [, index] of shown) {
    peak = Math.max(peak, index);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, 1 - index / peak);
  }
  return {
    points: shown,
    returns: { d7: growth(7), d30: growth(30), d90: growth(90), y1: growth(365) },
    maxDrawdown: shown.length > 1 ? maxDrawdown : null,
  };
}

// --- A wallet's own stakes

export interface VaultStake {
  venue: VaultVenue;
  id: string;
  /** USD value now (Lighter: shares × the pool's share price). */
  value: number | null;
  /** USD put in (Lighter's `entry_usdc`), when known. */
  entry: number | null;
  /** Withdrawals open after this (ms; Hyperliquid). */
  lockedUntil: number | null;
}

/** Hyperliquid `userVaultEquities`: [{ vaultAddress, equity, lockedUntilTimestamp }]. */
export function readHlStakes(raw: unknown): VaultStake[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const equity = num(entry?.equity);
    return typeof entry?.vaultAddress === "string" && equity !== null && equity > 0
      ? [{ venue: "hyperliquid" as const, id: entry.vaultAddress.toLowerCase(), value: equity, entry: null, lockedUntil: num(entry.lockedUntilTimestamp) }]
      : [];
  });
}

/**
 * Lighter `account?by=l1_address`: each account lists the pool shares it holds (`shares`: public_pool_index,
 * shares_amount, entry_usdc). Valued with the pool's share price from the vault list.
 */
export function readLighterStakes(raw: unknown, venue: Extract<VaultVenue, "lighter" | "lighterRh">, sharePrice: (id: string) => number | undefined): VaultStake[] {
  const accounts = (raw as { accounts?: unknown })?.accounts;
  if (!Array.isArray(accounts)) return [];
  const totals = new Map<string, { shares: number; entry: number }>();
  for (const account of accounts) {
    for (const share of Array.isArray(account?.shares) ? account.shares : []) {
      const index = num(share?.public_pool_index);
      const amount = num(share?.shares_amount);
      if (index === null || amount === null || amount <= 0) continue;
      const id = String(index);
      const total = totals.get(id) ?? { shares: 0, entry: 0 };
      totals.set(id, { shares: total.shares + amount, entry: total.entry + (num(share?.entry_usdc) ?? 0) });
    }
  }
  return [...totals].map(([id, total]) => {
    const price = sharePrice(id);
    return { venue, id, value: price === undefined ? null : total.shares * price, entry: total.entry || null, lockedUntil: null };
  });
}
