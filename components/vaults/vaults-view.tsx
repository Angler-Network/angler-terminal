"use client";

import { ChevronDown, ExternalLink, Search } from "lucide-react";
import dynamic from "next/dynamic";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { LoadingState } from "@/components/app/loading-state";
import { VenueLogo } from "@/components/terminal/venue-logo";
import { useWallet } from "@/components/terminal/wallet-provider";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import { lighterConfigs } from "@/lib/venues/lighter/config";
import { readHlStakes, readLighterStakes, type VaultStake } from "@/lib/vaults/parse";
import { isInAppVault, type InAppVaultVenue, type VaultTransferMode } from "@/lib/vaults/transfer";
import { VAULT_VENUE_NAMES, type VaultHistory, type VaultRow, type VaultVenue } from "@/lib/vaults/types";

// The venues' signing code loads with the window, not the page.
const VaultTransferDialog = dynamic(() => import("./vault-transfer-dialog").then((module) => module.VaultTransferDialog), { ssr: false });

const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const DAY_MS = 86_400_000;
/** "Established" (the default view): at least this much in it and this old. */
const ESTABLISHED_TVL = 10_000;
const ESTABLISHED_DAYS = 30;
const PAGE_ROWS = 60;
const rowButton =
  "inline-flex h-7 items-center gap-1 rounded-md border border-app-hairline-strong bg-app-chip px-2.5 text-[12px] font-semibold text-app-ink hover:bg-app-card";
const VENUES: VaultVenue[] = ["hyperliquid", "lighter", "lighterRh", "orderly", "extended"];

type SortKey = "tvl" | "apr" | "age";

const percent = (value: number | null | undefined, digits = 1) => (value === null || value === undefined ? "—" : `${value >= 0 ? "" : "−"}${Math.abs(value * 100).toFixed(digits)}%`);
const shortAddress = (value: string) => (/^0x[0-9a-f]{40}$/i.test(value) ? `${value.slice(0, 6)}…${value.slice(-4)}` : value);

function age(createdAt: number | null) {
  if (!createdAt) return "—";
  const days = Math.floor((Date.now() - createdAt) / DAY_MS);
  return days >= 365 ? `${(days / 365).toFixed(1)}y` : `${days}d`;
}

function Signed({ value, digits = 1 }: { value: number | null | undefined; digits?: number }) {
  if (value === null || value === undefined) return <span className="text-app-faint">—</span>;
  return <span className={value >= 0 ? "text-app-up" : "text-app-down"}>{percent(value, digits)}</span>;
}

/** The connected EVM wallet's stakes: Hyperliquid vault equities and Lighter (core and RH) pool shares, read from the browser. */
function useVaultStakes(address: string | null, vaults: VaultRow[] | null, version: number) {
  const [stakes, setStakes] = useState<VaultStake[] | null>(null);
  useEffect(() => {
    if (!address || !vaults) return setStakes(null);
    let active = true;
    const price = (venue: VaultVenue) => (id: string) => vaults.find((row) => row.venue === venue && row.id === id)?.sharePrice;
    const lighter = (venue: "lighter" | "lighterRh") =>
      fetch(`${lighterConfigs[venue].apiUrl}/api/v1/account?by=l1_address&value=${address}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((raw) => readLighterStakes(raw, venue, price(venue)))
        .catch(() => [] as VaultStake[]);
    void Promise.all([
      fetch(`${hlConfig.apiUrl}/info`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "userVaultEquities", user: address }) })
        .then((response) => (response.ok ? response.json() : null))
        .then(readHlStakes)
        .catch(() => [] as VaultStake[]),
      lighter("lighter"),
      lighter("lighterRh"),
    ]).then((lists) => active && setStakes(lists.flat()));
    return () => {
      active = false;
    };
  }, [address, vaults, version]);
  return stakes;
}

function Chart({ points }: { points: Array<[number, number]> }) {
  if (points.length < 2) return null;
  const width = 600;
  const height = 120;
  const values = points.map(([, value]) => value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const start = points[0][0];
  const range = points.at(-1)![0] - start || 1;
  const line = points.map(([t, value], index) => `${index ? "L" : "M"}${(((t - start) / range) * width).toFixed(1)},${(height - ((value - min) / span) * height).toFixed(1)}`).join("");
  const up = values.at(-1)! >= values[0];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-28 w-full" role="img" aria-label="Growth of 1 dollar kept in the vault">
      <path d={`${line}L${width},${height}L0,${height}Z`} className={up ? "fill-app-up/10" : "fill-app-down/10"} />
      <path d={line} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" className={up ? "stroke-app-up" : "stroke-app-down"} />
    </svg>
  );
}

function Stat({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div title={title} className="rounded-lg bg-app-chip/50 px-2.5 py-2">
      <p className="text-[11px] text-app-muted">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold tabular-nums">{children}</p>
    </div>
  );
}

/** The opened row: the same return and drawdown math for every venue (Orderly: its own figures per period). */
function VaultDetail({ vault }: { vault: VaultRow }) {
  const [history, setHistory] = useState<VaultHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/vaults/${vault.venue}/${vault.id}`)
      .then(async (response) => {
        const body = await response.json();
        if (!active) return;
        if (response.ok) setHistory(body as VaultHistory);
        else setError((body as { error?: string }).error ?? "Couldn't load this vault.");
      })
      .catch(() => active && setError("Couldn't load this vault."));
    return () => {
      active = false;
    };
  }, [vault.venue, vault.id]);

  if (error) return <p className="text-[12px] text-app-down">{error}</p>;
  if (!history) return <LoadingState label="Loading performance…" compact />;
  return (
    <div className="flex flex-col gap-3">
      {history.points.length > 1 ? (
        <>
          <Chart points={history.points} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="7 days">
              <Signed value={history.returns.d7} />
            </Stat>
            <Stat label="30 days">
              <Signed value={history.returns.d30} />
            </Stat>
            <Stat label="90 days">
              <Signed value={history.returns.d90} />
            </Stat>
            <Stat label="1 year">
              <Signed value={history.returns.y1} />
            </Stat>
            <Stat label="Max drawdown" title="Largest fall from a peak over the chart's period (up to a year)">
              <span className="text-app-down">{history.maxDrawdown === null ? "—" : percent(-history.maxDrawdown)}</span>
            </Stat>
          </div>
          <p className="text-[11px] text-app-faint">
            Growth of $1 kept in the vault: deposits and withdrawals don&apos;t move it, gains and losses do. Computed the same way for every venue.
          </p>
        </>
      ) : history.periods?.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {history.periods.map((period) => (
            <Stat key={period.range} label={period.range === "all_time" ? "All time" : period.range}>
              <span className={period.pnl >= 0 ? "text-app-up" : "text-app-down"}>{compactUsd.format(period.pnl)}</span>
              <span className="ml-1.5 text-[11px] font-normal text-app-muted">DD {percent(-period.maxDrawdown)}</span>
            </Stat>
          ))}
          <p className="col-span-full text-[11px] text-app-faint">{VAULT_VENUE_NAMES[vault.venue]} publishes PnL and drawdown per period, not a value history.</p>
        </div>
      ) : (
        <p className="text-[12px] text-app-muted">Not enough history yet.</p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-app-muted">
        {vault.manager && <span>Manager {shortAddress(vault.manager)}</span>}
        {vault.sharpe != null && <span>Sharpe {vault.sharpe.toFixed(2)} (Lighter)</span>}
        {vault.minDeposit != null && <span>Minimum {usd.format(vault.minDeposit)}</span>}
      </div>
    </div>
  );
}

/**
 * Every perp venue's vaults in one table (`/vaults`, public): HLP and Hyperliquid user vaults, Lighter's LLP and public
 * pools (core and RH), Orderly's OmniVault and strategy vaults. Hyperliquid and Lighter deposits and withdrawals run here
 * (`vault-transfer-dialog.tsx`, signed by the venue's trading key); Orderly's Deposit opens its own page.
 */
export function VaultsView() {
  const { address } = useWallet();
  const [data, setData] = useState<{ vaults: VaultRow[]; failed: VaultVenue[] } | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [venue, setVenue] = useState<VaultVenue | null>(null);
  const [established, setEstablished] = useState(true);
  const [sort, setSort] = useState<SortKey>("tvl");
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_ROWS);

  useEffect(() => {
    fetch("/api/vaults")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then(setData)
      .catch(() => setError(true));
  }, []);
  const vaults = data?.vaults ?? null;
  const [stakesVersion, setStakesVersion] = useState(0);
  const stakes = useVaultStakes(address, vaults, stakesVersion);
  const [transfer, setTransfer] = useState<{ vault: VaultRow & { venue: InAppVaultVenue }; mode: VaultTransferMode } | null>(null);
  const stakeOf = (row: VaultRow) => stakes?.find((stake) => stake.venue === row.venue && stake.id === row.id) ?? null;
  // A venue applies a transfer a moment after accepting it: read the stakes again now and once more shortly after.
  const afterTransfer = () => {
    setStakesVersion((value) => value + 1);
    window.setTimeout(() => setStakesVersion((value) => value + 1), 4000);
  };

  const isEstablished = (row: VaultRow) => row.tvl >= ESTABLISHED_TVL && (row.createdAt === null || Date.now() - row.createdAt >= ESTABLISHED_DAYS * DAY_MS);
  const shown = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const rows = (vaults ?? []).filter(
      (row) =>
        (!venue || row.venue === venue) &&
        (!established || row.kind === "protocol" || isEstablished(row)) &&
        (!wanted || row.name.toLowerCase().includes(wanted) || row.manager?.toLowerCase().includes(wanted)),
    );
    const key = (row: VaultRow) => (sort === "tvl" ? row.tvl : sort === "apr" ? (row.apr ?? -Infinity) : row.createdAt ? -row.createdAt : -Infinity);
    return rows.sort((a, b) => key(b) - key(a));
  }, [vaults, query, venue, established, sort]);
  const counts = useMemo(() => Object.fromEntries(VENUES.map((id) => [id, (vaults ?? []).filter((row) => row.venue === id).length])), [vaults]);

  const header = (key: SortKey | null, label: ReactNode, title?: string, align = "text-right") => (
    <th className={`px-3 py-2 ${align}`}>
      {key ? (
        <button
          type="button"
          onClick={() => setSort(key)}
          title={title}
          className={`inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.06em] ${sort === key ? "text-app-ink" : "text-app-faint hover:text-app-ink"}`}
        >
          {label}
          {sort === key && " ↓"}
        </button>
      ) : (
        <span title={title} className="text-[11px] font-medium uppercase tracking-[0.06em] text-app-faint">
          {label}
        </span>
      )}
    </th>
  );

  const mine = (stakes ?? []).map((stake) => ({ stake, vault: vaults?.find((row) => row.venue === stake.venue && row.id === stake.id) ?? null }));

  return (
    <section className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-app-hairline px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-[16px] font-semibold text-app-ink">Vaults</h1>
          <p className="text-[12px] text-app-muted">
            Every perp venue&apos;s vaults side by side. Past returns don&apos;t promise future ones: a vault can lose money, and the manager trades with it.
          </p>
        </div>
        <label className="ml-auto flex h-9 items-center gap-2 rounded-xl border border-app-field-border bg-app-field px-3">
          <Search className="size-4 text-app-faint" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search vaults"
            aria-label="Search vaults"
            className="w-40 bg-transparent text-[13px] text-app-ink outline-hidden placeholder:text-app-faint"
          />
        </label>
      </header>

      <div className="scrollbar-none flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-app-hairline px-4 py-2">
        {[null, ...VENUES].map((id) => {
          if (id && !counts[id]) return null;
          return (
            <button
              key={id ?? "all"}
              type="button"
              aria-pressed={venue === id}
              onClick={() => setVenue(id)}
              className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-colors ${
                venue === id ? "bg-app-ink text-app-card" : "bg-app-chip text-app-muted hover:text-app-ink"
              }`}
            >
              {id && <VenueLogo name={VAULT_VENUE_NAMES[id]} size={14} />}
              {id ? VAULT_VENUE_NAMES[id] : "All"}
              <span className="tabular-nums opacity-60">{id ? counts[id] : (vaults?.length ?? 0)}</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={established}
          onClick={() => setEstablished((value) => !value)}
          // Plain text: Intl's compact format differs between the server and some browsers ("$10.0K" / "$10K").
          title={`Only vaults with at least $${ESTABLISHED_TVL / 1000}K in them and ${ESTABLISHED_DAYS}+ days of history (the venues' own vaults always show)`}
          className={`ml-auto inline-flex h-7 shrink-0 items-center rounded-lg px-2.5 text-[12px] font-semibold transition-colors ${
            established ? "bg-app-ink text-app-card" : "bg-app-chip text-app-muted hover:text-app-ink"
          }`}
        >
          Established only
        </button>
      </div>

      <div className="scrollbar-subtle min-h-0 flex-1 overflow-auto">
        {mine.length > 0 && (
          <div className="border-b border-app-hairline px-4 py-3">
            <h2 className="text-[12px] font-semibold text-app-ink">Your vaults</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {mine.map(({ stake, vault }) => (
                <li key={`${stake.venue}:${stake.id}`} className="flex items-center gap-2 rounded-lg bg-app-chip/60 px-2.5 py-1.5 text-[12px] tabular-nums">
                  <VenueLogo name={VAULT_VENUE_NAMES[stake.venue]} size={14} />
                  <span className="font-semibold text-app-ink">{vault?.name ?? shortAddress(stake.id)}</span>
                  <span className="text-app-ink">{stake.value === null ? "—" : usd.format(stake.value)}</span>
                  {stake.entry !== null && stake.value !== null && (
                    <span className={stake.value >= stake.entry ? "text-app-up" : "text-app-down"}>
                      {stake.value >= stake.entry ? "+" : "−"}
                      {usd.format(Math.abs(stake.value - stake.entry))}
                    </span>
                  )}
                  {stake.lockedUntil !== null && stake.lockedUntil > Date.now() && <span className="text-app-faint">locked until {new Date(stake.lockedUntil).toLocaleDateString()}</span>}
                  {vault && isInAppVault(vault) && (
                    <button type="button" onClick={() => setTransfer({ vault, mode: "withdraw" })} className="font-semibold text-app-muted underline-offset-2 hover:text-app-ink hover:underline">
                      Manage
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {data?.failed.length ? <p className="px-4 pt-2 text-[12px] text-app-muted">Couldn&apos;t reach {data.failed.map((id) => VAULT_VENUE_NAMES[id]).join(", ")} right now.</p> : null}
        <table className="w-full min-w-[640px] text-[12px] tabular-nums">
          <thead className="sticky top-0 z-10 bg-app-card">
            <tr>
              {header(null, "Vault", undefined, "text-left")}
              {header("tvl", "TVL")}
              {header("apr", "APR", "The yearly rate each venue shows, as it computes it (Hyperliquid's APR, Lighter's APY, Orderly's 30-day APY). Open a row for returns computed the same way for all.")}
              {header("age", "Age")}
              {header(null, "Manager share", "Share of the profits the manager keeps")}
              {header(null, "Lock", "How long a deposit stays locked")}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((row) => {
              const key = `${row.venue}:${row.id}`;
              const expanded = open === key;
              return (
                <Fragment key={key}>
                  <tr className="border-t border-app-hairline hover:bg-app-chip/40">
                    <td className="px-3 py-1.5">
                      {/* A width cap on the cell itself doesn't hold in an auto table: the button carries it, so long names truncate. */}
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : key)}
                        aria-expanded={expanded}
                        className="flex w-[170px] min-w-0 items-center gap-2 text-left sm:w-auto sm:max-w-[340px]"
                      >
                        <VenueLogo name={VAULT_VENUE_NAMES[row.venue]} size={18} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-app-ink">{row.name}</span>
                          <span className="block truncate text-[11px] text-app-faint">
                            {VAULT_VENUE_NAMES[row.venue]}
                            {row.kind === "protocol" ? " · run by the venue" : row.manager ? ` · ${shortAddress(row.manager)}` : ""}
                          </span>
                        </span>
                        <ChevronDown className={`size-3.5 shrink-0 text-app-faint transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
                      </button>
                    </td>
                    <td className="px-3 py-1.5 text-right text-app-ink">{compactUsd.format(row.tvl)}</td>
                    <td className="px-3 py-1.5 text-right" title={row.aprBasis}>
                      <Signed value={row.apr} />
                    </td>
                    <td className="px-3 py-1.5 text-right text-app-muted">{age(row.createdAt)}</td>
                    <td className="px-3 py-1.5 text-right text-app-muted">{row.profitShare === null ? "—" : percent(row.profitShare, 0)}</td>
                    <td className="px-3 py-1.5 text-right text-app-muted">{row.lockHours === null ? "—" : row.lockHours >= 48 ? `${Math.round(row.lockHours / 24)}d` : `${row.lockHours}h`}</td>
                    <td className="px-3 py-1.5 text-right">
                      {isInAppVault(row) ? (
                        <span className="inline-flex gap-1.5">
                          {stakeOf(row)?.value ? (
                            <button type="button" onClick={() => setTransfer({ vault: row, mode: "withdraw" })} className={rowButton}>
                              Withdraw
                            </button>
                          ) : null}
                          {row.open && (
                            <button type="button" onClick={() => setTransfer({ vault: row, mode: "deposit" })} className={rowButton}>
                              Deposit
                            </button>
                          )}
                        </span>
                      ) : (
                        row.url && (
                          <a href={row.url} target="_blank" rel="noopener noreferrer" title={`Deposit on ${VAULT_VENUE_NAMES[row.venue]}'s own page`} className={rowButton}>
                            Deposit
                            <ExternalLink className="size-3" aria-hidden />
                          </a>
                        )
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="bg-app-chip/20">
                      <td colSpan={7} className="px-4 py-3">
                        <VaultDetail vault={row} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {limit < shown.length && (
          <button type="button" onClick={() => setLimit((current) => current + PAGE_ROWS)} className="w-full py-3 text-[12px] font-semibold text-app-muted hover:text-app-ink">
            Show more ({shown.length - limit})
          </button>
        )}
        {!vaults && !error && <LoadingState label="Loading vaults…" />}
        {error && <p className="p-6 text-center text-[12px] text-app-muted">Couldn&apos;t load vaults right now.</p>}
        {vaults && shown.length === 0 && <p className="p-6 text-center text-[12px] text-app-muted">No vault matches.</p>}
      </div>
      {transfer && (
        <VaultTransferDialog
          key={`${transfer.vault.venue}:${transfer.vault.id}`}
          vault={transfer.vault}
          stake={stakeOf(transfer.vault)}
          initialMode={transfer.mode}
          onClose={() => setTransfer(null)}
          onDone={afterTransfer}
        />
      )}
    </section>
  );
}
