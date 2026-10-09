"use client";

import { ArrowRight, Gift, Sparkles, TrendingUp, Trophy } from "lucide-react";
import Link from "next/link";
import BorderGlow from "@/components/fx/border-glow";
import Counter from "@/components/fx/counter";
import { BETA_POINTS_MULTIPLIER, pointsFor } from "@/lib/profile/levels";
import { vipFor } from "@/lib/profile/vip";
import { useProfile } from "./profile-provider";

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const card = "rounded-2xl border border-app-hairline bg-app-card/60";
/** Angler gold, for the cards' edge glow. */
const GOLD = ["rgb(var(--app-accent))", "#e9b45a", "#fff1cf"];

function SourceCard({
  icon,
  title,
  value,
  detail,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  detail: string;
  cta: { label: string; href: string };
}) {
  return (
    // The edge lights up in gold toward the pointer (only while hovered, so it costs nothing otherwise).
    <BorderGlow className="h-full" backgroundColor="rgb(var(--app-card))" borderRadius={16} glowColor="accent" glowRadius={28} colors={GOLD} fillOpacity={0.35}>
    <section className="group relative flex h-full flex-col overflow-hidden p-5">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-app-accent/[0.06] blur-2xl" />
      <span className="flex size-10 items-center justify-center rounded-xl bg-app-accent/12 text-app-accent ring-1 ring-app-accent/20">{icon}</span>
      <h3 className="mt-4 text-[13px] font-semibold text-app-muted">{title}</h3>
      <p className="mt-0.5 text-[26px] font-semibold tabular-nums tracking-tight text-app-ink">{value}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-app-muted">{detail}</p>
      <Link href={cta.href} className="mt-auto inline-flex items-center gap-1 pt-4 text-[12px] font-semibold text-app-ink hover:text-app-accent">
        {cta.label}
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </section>
    </BorderGlow>
  );
}

/**
 * Rewards: total points with rank and level, where they come from (trading, referrals) and what they unlock (VIP),
 * and the last 30 days of trading points.
 */
export function RewardsView() {
  const { profile, loading, error } = useProfile();
  if (!profile) return <p className="py-12 text-center text-[13px] text-app-muted">{error ?? (loading ? "Loading your rewards…" : "Connect a wallet to see your rewards.")}</p>;

  const { level } = profile;
  const tradingPoints = Math.max(0, profile.points - profile.referralPoints);
  const vip = vipFor(profile.recentVolume.d30);
  const history = profile.daily.map((day) => ({ ...day, points: pointsFor(day.usd + (day.bonusUsd ?? 0)) }));
  const max = Math.max(0.01, ...history.map((day) => day.points));
  const earned30 = history.reduce((sum, day) => sum + day.points, 0);
  const active = [...history].reverse().filter((day) => day.points > 0);

  return (
    <>
      <section className={`${card} relative overflow-hidden px-6 py-5 sm:px-7 sm:py-6`}>
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_120%_at_0%_0%,rgb(var(--app-accent)/0.14),transparent_55%),radial-gradient(50%_90%_at_100%_100%,rgb(var(--app-accent)/0.06),transparent_60%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-app-accent">
              <Sparkles className="size-3.5" strokeWidth={1.75} aria-hidden />
              Total points
              {profile.closedBeta && (
                <span title="Trades placed during the closed beta earn double points" className="ml-1 rounded-md bg-app-accent/15 px-1.5 py-0.5 text-[10px] tracking-normal normal-case">
                  {BETA_POINTS_MULTIPLIER}x closed beta
                </span>
              )}
            </p>
            {/* Digits roll to each new total. */}
            <div className="mt-1 -ml-2 font-semibold tracking-tight text-app-ink">
              {/* Slots as wide as Sora's tabular digits (0.676em); Counter's default 1ch is the wider proportional "0". */}
              <Counter
                value={Math.round(profile.points * 100) / 100}
                fontSize={44}
                gap={0}
                horizontalPadding={8}
                gradientHeight={0}
                fontWeight={600}
                digitStyle={{ width: "0.68em" }}
              />
            </div>
            <p className="mt-1.5 text-[13px] text-app-muted">
              <span className="font-semibold text-app-ink">+{number.format(earned30)}</span> trading points in the last 30 days
            </p>
          </div>
          <dl className="flex divide-x divide-app-hairline">
            <div className="pr-6">
              <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-app-faint">Rank</dt>
              <dd className="mt-1 flex items-center gap-1.5 text-[18px] font-semibold tabular-nums text-app-ink">
                <Trophy className="size-4 text-app-accent" strokeWidth={1.75} aria-hidden />
                {profile.rank ? `#${profile.rank}` : "—"}
              </dd>
            </div>
            <div className="pl-6">
              <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-app-faint">Level</dt>
              <dd className="mt-1 text-[18px] font-semibold text-app-ink">{level.name}</dd>
            </div>
          </dl>
        </div>
        <div className="relative mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-app-chip" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level.progress * 100)}>
            {/* No fill at 0: a sliver would read as progress that isn't there. */}
            {level.progress > 0 && <div className="h-full rounded-full bg-linear-to-r from-app-accent/60 to-app-accent" style={{ width: `${level.progress * 100}%` }} />}
          </div>
          <p className="mt-2 flex justify-between text-[12px] tabular-nums text-app-muted">
            {level.next === null ? (
              <span>{level.name} · top level reached</span>
            ) : (
              <>
                <span>
                  {level.name} <span className="text-app-faint">→</span> <span className="text-app-ink">{level.nextName}</span>
                </span>
                <span>{number.format(level.next - profile.points)} points to go</span>
              </>
            )}
          </p>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <SourceCard
          icon={<TrendingUp className="size-5" strokeWidth={1.75} aria-hidden />}
          title="Trading"
          value={number.format(tradingPoints)}
          detail="Earn 1 point per $100 traded."
          cta={{ label: "Trade now", href: "/perp" }}
        />
        <SourceCard
          icon={<Gift className="size-5" strokeWidth={1.75} aria-hidden />}
          title="Referrals"
          value={number.format(profile.referralPoints)}
          detail="Earn 10% of your referrals’ points."
          cta={{ label: "Invite traders", href: "/profile#referrals" }}
        />
        <SourceCard
          icon={<Sparkles className="size-5" strokeWidth={1.75} aria-hidden />}
          title="VIP"
          value={`VIP ${vip.level}`}
          detail={`${compactUsd.format(profile.recentVolume.d30)} traded in the last 30 days. More volume, a bigger discount on Angler's perp fees (Hyperliquid, Lighter, Aster).`}
          cta={{ label: "See VIP tiers", href: "/profile" }}
        />
      </div>

      <section className={card}>
        <header className="flex items-center justify-between border-b border-app-hairline px-5 py-3.5">
          <h3 className="text-[13px] font-semibold text-app-ink">Points history</h3>
          <span className="text-[11px] text-app-faint">Trading points, last 30 days (UTC)</span>
        </header>
        <div className="px-5 pt-5">
          <div className="flex h-[120px] items-end gap-[3px]" role="img" aria-label="Trading points per day over the last 30 days">
            {history.map((day) => (
              <div key={day.date} className="group relative flex h-full flex-1 items-end">
                <div
                  title={`${day.date}: ${number.format(day.points)} points (${compactUsd.format(day.usd)} traded)`}
                  className={`w-full rounded-t-sm ${day.points > 0 ? "bg-app-accent/70 group-hover:bg-app-accent" : "bg-app-chip"}`}
                  style={{ height: `${Math.max(3, (day.points / max) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-app-faint">
            <span>{history[0]?.date.slice(5)}</span>
            <span>Today</span>
          </div>
        </div>
        <ul className="mt-3 divide-y divide-app-hairline border-t border-app-hairline">
          {active.slice(0, 10).map((day) => (
            <li key={day.date} className="flex items-center justify-between px-5 py-2.5 text-[13px] tabular-nums">
              <span className="text-app-muted">{new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span>
              <span className="text-app-faint">{compactUsd.format(day.usd)} traded</span>
              <span className="font-semibold text-app-ink">+{number.format(day.points)}</span>
            </li>
          ))}
          {active.length === 0 && <li className="px-5 py-8 text-center text-[13px] text-app-muted">No points in the last 30 days yet. Your next trade starts the streak.</li>}
        </ul>
      </section>
    </>
  );
}
