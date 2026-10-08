"use client";

import { useEffect, useState } from "react";
import type { RevenueReport, RevenueSummary } from "@/lib/analytics/revenue";
import { useProfile } from "./profile-provider";

const card = "rounded-2xl border border-app-hairline bg-app-card/60";
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const VENUE_NAMES: Record<string, string> = {
  hyperliquid: "Hyperliquid",
  lighter: "Lighter",
  lighterRh: "Lighter RH",
  jupiter: "Jupiter",
  titan: "Titan",
  arcus: "Arcus",
  uniswap: "Uniswap",
  relay: "Relay",
  lifi: "LI.FI",
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
        <span className="rounded-md bg-[#f5c97b]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#f5c97b]">Admin</span>
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
                  className={`w-full rounded-t-md transition-[height] ${value > 0 ? (metric === "fee" ? "bg-[#f5c97b]/80 group-hover:bg-[#f5c97b]" : "bg-app-accent/70 group-hover:bg-app-accent") : "bg-app-chip"}`}
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
                <span className="text-app-ink">{VENUE_NAMES[venue] ?? venue}</span>
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
    </>
  );
}
