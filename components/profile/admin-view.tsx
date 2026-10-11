"use client";

import { useEffect, useState } from "react";
import type { RevenueReport, RevenueSummary } from "@/lib/analytics/revenue";
import { shortAddress } from "@/lib/profile/identity";
import type { Payable } from "@/lib/profile/store";
import { announceClosedBeta, useClosedBeta, useOffServices } from "@/components/app/service-status";
import { VenueLogo } from "@/components/terminal/venue-logo";
import { useProfile } from "./profile-provider";

const card = "rounded-2xl border border-app-hairline bg-app-card/60";
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const VENUE_NAMES: Record<string, string> = {
  hyperliquid: "Hyperliquid",
  lighter: "Lighter",
  lighterRh: "Lighter RH",
  aster: "Aster",
  orderly: "Orderly",
  extended: "Extended",
  jupiter: "Jupiter",
  titan: "Titan",
  arcus: "Arcus",
  uniswap: "Uniswap",
  zerox: "0x",
  kyberswap: "KyberSwap",
  relay: "Relay",
  lifi: "LI.FI",
  polymarket: "Polymarket",
};

type Report = RevenueReport & { years: number[] };

/** What the panel shows: our revenue (fees) or the traded volume. */
type Metric = "fee" | "usd";

const METRICS: Array<{ value: Metric; label: string }> = [
  { value: "fee", label: "Revenue" },
  { value: "usd", label: "Volume" },
];

const money = (metric: Metric, value: number) => (metric === "fee" ? usd.format(value) : compactUsd.format(value));

function Stat({ label, value, metric }: { label: string; value: RevenueSummary | undefined; metric: Metric }) {
  return (
    <div className={`${card} p-4`}>
      <p className="text-[12px] text-app-muted">{label}</p>
      <p className="mt-1 text-[24px] font-semibold tabular-nums tracking-tight text-app-ink">{value ? money(metric, value[metric]) : "—"}</p>
      <p className="mt-0.5 text-[11px] tabular-nums text-app-faint">
        {value ? `${metric === "fee" ? `${compactUsd.format(value.usd)} volume` : `${usd.format(value.fee)} revenue`} · ${value.trades.toLocaleString("en-US")} trades` : " "}
      </p>
    </div>
  );
}

const SERVICES: Array<{ id: string; name: string }> = [
  { id: "bridge:across", name: "Across" },
  { id: "bridge:relay", name: "Relay" },
  { id: "bridge:lifi", name: "LI.FI" },
  { id: "swap:zerox", name: "0x" },
  { id: "swap:kyberswap", name: "KyberSwap" },
];

/**
 * The closed beta switch (`lib/ops/beta.ts`). On: every page but home and Vaults asks for access, and only admins'
 * invite codes let people in (trading earns none). Off: no gate, and invites work as referrals again.
 */
function ClosedBetaPanel() {
  const { profile, refresh } = useProfile();
  const closed = useClosedBeta(profile?.closedBeta ?? true);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const flip = async () => {
    if (!armed) return setArmed(true);
    setArmed(false);
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/beta", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ closed: !closed }) });
    const body = (await response.json().catch(() => ({}))) as { closedBeta?: unknown; error?: string };
    if (response.ok && typeof body.closedBeta === "boolean") announceClosedBeta(body.closedBeta);
    else setMessage(body.error ?? "Couldn't change it.");
    refresh();
    setBusy(false);
  };
  return (
    <section className={`${card} p-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`size-2 rounded-full ${closed ? "bg-[#f5c97b]" : "bg-app-up"}`} aria-hidden />
        <h3 className="text-[13px] font-semibold text-app-ink">Closed beta</h3>
        <span className="text-[12px] text-app-muted">{closed ? "On: invite only" : "Off: open to everyone"}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void flip()}
          onBlur={() => setArmed(false)}
          className={`ml-auto h-7 rounded-lg px-2.5 text-[12px] font-semibold disabled:opacity-60 ${
            armed ? "bg-app-down text-white" : closed ? "bg-app-up text-black" : "border border-app-hairline-strong text-app-ink hover:bg-app-selected/70"
          }`}
        >
          {busy ? "Saving…" : armed ? (closed ? "Confirm: open to everyone" : "Confirm: invite only") : closed ? "Open the beta" : "Close the beta"}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-app-faint">
        {closed
          ? "Every page but home and Vaults asks for access. Only admins create invite codes, and only theirs let people in; trading earns none for now."
          : "No gate: anyone can trade. Trading earns invite codes again and any trader's code works as a referral."}{" "}
        Open tabs follow within a minute.
      </p>
      {message && <p className="mt-2 text-[12px] text-app-down">{message}</p>}
    </section>
  );
}

/** Kill switches: turn a service off for everyone at once (a hacked or failing bridge); browsers drop it within a minute. */
function ServicesPanel() {
  const { off, refresh } = useOffServices();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const toggle = async (id: string, turnOff: boolean) => {
    setBusy(id);
    setMessage(null);
    const response = await fetch("/api/admin/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, off: turnOff }) });
    if (!response.ok) setMessage(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't change it.");
    await refresh();
    setBusy(null);
  };
  return (
    <section className={`${card} p-4`}>
      <h3 className="text-[13px] font-semibold text-app-ink">Services</h3>
      <p className="mt-1 text-[11px] text-app-faint">Turn a bridge or aggregator off for everyone if it&apos;s hacked or failing. It stops being quoted in every browser within a minute.</p>
      <ul className="mt-3 divide-y divide-app-hairline">
        {SERVICES.map((service) => {
          const isOff = off.includes(service.id);
          return (
            <li key={service.id} className="flex items-center gap-3 py-2.5 text-[13px]">
              <span className={`size-2 rounded-full ${isOff ? "bg-app-down" : "bg-app-up"}`} aria-hidden />
              <span className="font-semibold text-app-ink">{service.name}</span>
              <span className="text-[12px] text-app-faint">{isOff ? "Off for everyone" : "On"}</span>
              <button
                type="button"
                disabled={busy === service.id}
                onClick={() => void toggle(service.id, !isOff)}
                className={`ml-auto h-7 rounded-lg px-2.5 text-[12px] font-semibold disabled:opacity-60 ${isOff ? "bg-app-up text-black" : "border border-app-down/50 text-app-down hover:bg-app-down/10"}`}
              >
                {isOff ? "Turn back on" : "Turn off for everyone"}
              </button>
            </li>
          );
        })}
      </ul>
      {message && <p className="mt-2 text-[12px] text-app-down">{message}</p>}
    </section>
  );
}

/**
 * Referral payouts: who is owed what. After sending someone their claimable fees (their Discord ticket), the admin
 * records it here; their claimable balance drops by that amount and the payout stays in the history.
 */
function PayoutsPanel() {
  const [rows, setRows] = useState<Payable[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/payouts", { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as { payables: Payable[] }).payables : []))
      .then((next) => !cancelled && setRows(next))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const owed = (rows ?? []).reduce((sum, row) => sum + row.claimable, 0);

  return (
    <section className={`${card} p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-app-ink">Referral payouts</h3>
        <span className="text-[12px] tabular-nums text-app-muted">
          Owed in total <span className="font-semibold text-app-up">{usd.format(owed)}</span>
        </span>
      </div>
      <p className="mt-1 text-[11px] text-app-faint">Send the claimable USDC to the wallet from their Discord ticket, then mark it paid here.</p>
      <ul className="mt-3 divide-y divide-app-hairline">
        {(rows ?? []).map((row) => (
          <li key={row.id} className="py-2.5">
            <div className="flex flex-wrap items-center gap-3 text-[13px] tabular-nums">
              <button type="button" onClick={() => void navigator.clipboard?.writeText(row.id)} title={`Copy ${row.id}`} className="font-semibold text-app-ink hover:underline">
                {row.username ?? shortAddress(row.id)}
              </button>
              <span className="text-[12px] text-app-faint">
                {usd.format(row.earned)} earned · {usd.format(row.paid)} paid
              </span>
              <span className={`ml-auto font-semibold ${row.claimable > 0 ? "text-app-up" : "text-app-faint"}`}>{usd.format(row.claimable)}</span>
              {row.claimable > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(open === row.id ? null : row.id);
                    setAmount(row.claimable.toFixed(2));
                    setReference("");
                    setMessage(null);
                  }}
                  className="h-7 rounded-lg border border-app-hairline-strong px-2.5 text-[12px] font-semibold text-app-ink hover:bg-app-selected/70"
                >
                  Mark paid
                </button>
              )}
            </div>
            {open === row.id && (
              <form
                className="mt-2 flex flex-wrap items-center gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setBusy(true);
                  const response = await fetch("/api/admin/payouts", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ profile: row.id, usd: Number(amount), reference }),
                  });
                  const body = (await response.json().catch(() => ({}))) as { error?: string };
                  setBusy(false);
                  if (!response.ok) return setMessage(body.error ?? "Couldn't record the payout.");
                  setOpen(null);
                  setVersion((value) => value + 1);
                }}
              >
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  aria-label="Amount paid in USD"
                  className="h-8 w-28 rounded-lg border border-app-field-border bg-app-field px-2.5 text-[13px] tabular-nums text-app-ink outline-none focus:border-app-ink"
                />
                <input
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="Transfer hash or note"
                  aria-label="Transfer hash or note"
                  className="h-8 min-w-0 flex-1 rounded-lg border border-app-field-border bg-app-field px-2.5 text-[13px] text-app-ink outline-none focus:border-app-ink"
                />
                <button type="submit" disabled={busy} className="h-8 rounded-lg bg-app-up px-3 text-[12px] font-semibold text-black disabled:opacity-60">
                  {busy ? "Saving…" : "Confirm paid"}
                </button>
                {message && <span className="basis-full text-[12px] text-app-down">{message}</span>}
              </form>
            )}
          </li>
        ))}
        {rows !== null && rows.length === 0 && <li className="py-3 text-[12px] text-app-muted">Nobody has referral earnings yet.</li>}
        {rows === null && <li className="py-3 text-[12px] text-app-muted">Loading…</li>}
      </ul>
    </section>
  );
}

/** Admins only: platform revenue (all time, 30 and 7 days, month by month for a year) and the invite tools. */
export function AdminView({ invites }: { invites: React.ReactNode }) {
  const { profile, signIn } = useProfile();
  const [year, setYear] = useState<number | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [status, setStatus] = useState<"loading" | "signin" | "error" | "ready">("loading");
  const [signing, setSigning] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [metric, setMetric] = useState<Metric>("fee");

  useEffect(() => {
    if (!profile?.admin) return;
    let cancelled = false;
    setStatus("loading");
    fetch(`/api/admin/revenue${year ? `?year=${year}` : ""}`, { cache: "no-store" })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 401) return setStatus("signin");
        if (!response.ok) return setStatus("error");
        setReport((await response.json()) as Report);
        setStatus("ready");
      })
      .catch(() => !cancelled && setStatus("error"));
    return () => {
      cancelled = true;
    };
  }, [profile?.admin, year, attempt]);

  if (!profile) return null;
  if (!profile.admin) return <p className="py-12 text-center text-[13px] text-app-muted">This section is for admins.</p>;
  if (status === "signin") {
    return (
      <section className={`${card} flex flex-col items-start gap-3 p-5`}>
        <h2 className="text-[15px] font-semibold text-app-ink">Admin</h2>
        <p className="text-[13px] text-app-muted">Sign in with your wallet to see platform revenue. One signature, no fee, good for 30 days.</p>
        <button
          type="button"
          disabled={signing}
          onClick={async () => {
            setSigning(true);
            if (!(await signIn())) setAttempt((value) => value + 1);
            setSigning(false);
          }}
          className="h-9 rounded-xl bg-app-accent px-4 text-[13px] font-semibold text-app-on-accent disabled:opacity-60"
        >
          {signing ? "Sign in your wallet…" : "Sign in"}
        </button>
      </section>
    );
  }

  const max = Math.max(1, ...(report?.months.map((month) => month[metric]) ?? [0]));
  const venues = report ? Object.entries(report.allTime.byVenue).filter(([, value]) => value.fee > 0 || value.usd > 0).sort(([, a], [, b]) => b[metric] - a[metric]) : [];

  return (
    <>
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-app-ink">Platform {metric === "fee" ? "revenue" : "volume"}</h2>
        <span className="rounded-md bg-app-accent/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-app-accent">Admin</span>
        {status === "error" && <span className="text-[12px] text-app-down">Couldn&apos;t load the numbers.</span>}
        <div role="group" aria-label="Metric" className="ml-auto flex gap-0.5 rounded-lg bg-app-chip p-0.5">
          {METRICS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={metric === option.value}
              onClick={() => setMetric(option.value)}
              className={`h-7 rounded-md px-3 text-[12px] font-semibold transition-colors ${metric === option.value ? "bg-app-card text-app-ink shadow-xs" : "text-app-muted hover:text-app-ink"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="All time" value={report?.allTime} metric={metric} />
        <Stat label="Last 30 days" value={report?.last30} metric={metric} />
        <Stat label="Last 7 days" value={report?.last7} metric={metric} />
      </div>

      <section className={`${card} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-app-ink">By month</h3>
          <div role="group" aria-label="Year" className="flex gap-0.5 rounded-lg bg-app-chip p-0.5">
            {(report?.years ?? []).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={report?.year === option}
                onClick={() => setYear(option)}
                className={`h-7 rounded-md px-2.5 text-[12px] font-semibold transition-colors ${report?.year === option ? "bg-app-card text-app-ink shadow-xs" : "text-app-muted hover:text-app-ink"}`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid h-[220px] grid-cols-12 items-end gap-2" role="img" aria-label={`${metric === "fee" ? "Revenue" : "Volume"} by month in ${report?.year ?? ""}`}>
          {MONTHS.map((name, index) => {
            const month = report?.months[index];
            const value = month?.[metric] ?? 0;
            return (
              <div key={name} className="group flex h-full flex-col items-center justify-end gap-1.5">
                <span className="text-[10px] tabular-nums text-app-muted opacity-0 transition-opacity group-hover:opacity-100">{value > 0 ? compactUsd.format(value) : ""}</span>
                <div
                  title={month ? `${name} ${report?.year}: ${usd.format(month.fee)} revenue, ${compactUsd.format(month.usd)} volume` : name}
                  className={`w-full rounded-t-md transition-[height] ${value > 0 ? (metric === "fee" ? "bg-app-accent/80 group-hover:bg-app-accent" : "bg-app-accent/70 group-hover:bg-app-accent") : "bg-app-chip"}`}
                  style={{ height: `${Math.max(2, (value / max) * 100)}%` }}
                />
                <span className="text-[10px] text-app-faint">{name}</span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${card} p-4`}>
          <h3 className="text-[13px] font-semibold text-app-ink">By venue, all time</h3>
          <ul className="mt-2 divide-y divide-app-hairline">
            {venues.map(([venue, value]) => (
              <li key={venue} className="flex items-center justify-between py-2 text-[13px] tabular-nums">
                <span className="flex items-center gap-2 text-app-ink">
                  <VenueLogo name={VENUE_NAMES[venue] ?? venue} size={18} />
                  {VENUE_NAMES[venue] ?? venue}
                </span>
                <span className="text-app-muted">
                  <span className="font-semibold text-app-ink">{money(metric, value[metric])}</span> · {metric === "fee" ? `${compactUsd.format(value.usd)} volume` : `${usd.format(value.fee)} revenue`}
                </span>
              </li>
            ))}
            {venues.length === 0 && <li className="py-3 text-[12px] text-app-muted">{status === "loading" ? "Loading…" : "No trades yet."}</li>}
          </ul>
          <p className="mt-2 text-[11px] text-app-faint">Estimated from each trade the terminal placed, at the fee rate it carried.</p>
        </section>
        {invites}
      </div>
      {status === "ready" && <PayoutsPanel />}
      {status === "ready" && <ClosedBetaPanel />}
      {status === "ready" && <ServicesPanel />}
    </>
  );
}
