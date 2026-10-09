"use client";

import { Check, ExternalLink, Link2, Pencil, Trophy, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PortfolioView } from "@/components/portfolio/portfolio-view";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { BETA_POINTS_MULTIPLIER, LEVELS } from "@/lib/profile/levels";
import { VIP_TIERS, nextVip, vipFor } from "@/lib/profile/vip";
import { shortAddress, usernameError } from "@/lib/profile/identity";
import { INVITE_VOLUME } from "@/lib/profile/invites";
import type { LeaderboardEntry, ProfileVenue, ProfileView as ProfileData } from "@/lib/profile/store";
import BorderGlow from "@/components/fx/border-glow";
import { DISCORD } from "@/components/app/social-links";
import { AdminView } from "./admin-view";
import { AlertsView } from "./alerts-view";
import { DiscordRolesCard } from "./discord-roles-card";
import { PortfolioCard } from "./portfolio-card";
import { RewardsView } from "./rewards-view";
import { ProfileAvatar } from "./profile-avatar";
import { useProfile } from "./profile-provider";

export type ProfileTab = "overview" | "rewards" | "portfolio" | "alerts" | "leaderboard" | "admin";

const tabs: Array<{ id: ProfileTab; label: string; href: string }> = [
  { id: "overview", label: "Overview", href: "/profile" },
  { id: "rewards", label: "Rewards", href: "/profile/rewards" },
  { id: "portfolio", label: "Portfolio", href: "/profile/portfolio" },
  { id: "alerts", label: "Alerts", href: "/profile/alerts" },
  { id: "leaderboard", label: "Leaderboard", href: "/profile/leaderboard" },
  { id: "admin", label: "Admin", href: "/profile/admin" },
];

const VENUES: Array<{ id: ProfileVenue; name: string; kind: string }> = [
  { id: "hyperliquid", name: "Hyperliquid", kind: "Perps" },
  { id: "lighter", name: "Lighter", kind: "Perps" },
  { id: "lighterRh", name: "Lighter RH", kind: "Stock perps" },
  { id: "aster", name: "Aster", kind: "Perps" },
  { id: "orderly", name: "Orderly", kind: "Perps" },
  { id: "jupiter", name: "Jupiter", kind: "Swap" },
  { id: "titan", name: "Titan", kind: "Swap" },
];

const card = "rounded-2xl border border-app-hairline bg-app-card/60";
/** Angler's Discord (`NEXT_PUBLIC_DISCORD_URL`): referral earnings are withdrawn through a ticket there. */
const DISCORD_URL = DISCORD?.url ?? null;
// Points carry two decimals (0.01 per $100).
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function UsernameEditor({ current, onDone }: { current: string | null; onDone: () => void }) {
  const { saveUsername } = useProfile();
  const [draft, setDraft] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const invalid = draft ? usernameError(draft) : null;

  const submit = async () => {
    if (!draft || invalid) return setError(invalid ?? "Pick a username.");
    setSaving(true);
    const failure = await saveUsername(draft);
    setSaving(false);
    if (failure) setError(failure);
    else onDone();
  };

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={draft}
          maxLength={20}
          onChange={(event) => {
            setDraft(event.target.value.trim());
            setError(null);
          }}
          onKeyDown={(event) => event.key === "Escape" && onDone()}
          placeholder="username"
          aria-label="Username"
          className="h-9 w-[200px] rounded-xl border border-app-field-border bg-app-field px-3 text-[15px] font-semibold text-app-ink outline-hidden focus:border-app-focus"
        />
        <button type="submit" disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-app-accent px-3 text-[13px] font-semibold text-app-on-accent disabled:opacity-60">
          <Check className="size-4" aria-hidden />
          {saving ? "Sign in wallet…" : "Sign & save"}
        </button>
        <button type="button" onClick={onDone} aria-label="Cancel" className="inline-flex size-9 items-center justify-center rounded-xl text-app-muted hover:bg-app-selected/70 hover:text-app-ink">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <p className={`text-[11px] ${error || invalid ? "text-app-down" : "text-app-faint"}`}>
        {error ?? invalid ?? "3-20 letters, digits or _. Your wallet signs the change: free, no transaction."}
      </p>
    </form>
  );
}

function ProfileHeader({ tab }: { tab: ProfileTab }) {
  const { id, profile } = useProfile();
  const [editing, setEditing] = useState(false);
  const shownId = profile?.id ?? id;

  return (
    <header className={`surface-panel shrink-0 ${card} bg-app-card/55 px-4 pt-4 sm:px-5`}>
      <div className="flex flex-wrap items-center gap-4 pb-4">
        {shownId ? <ProfileAvatar id={shownId} size={56} image={profile?.ens?.avatar} /> : <span className="inline-flex size-14 items-center justify-center rounded-full bg-app-chip"><Wallet className="size-6 text-app-muted" aria-hidden /></span>}
        <div className="min-w-0 flex-1">
          {editing ? (
            <UsernameEditor current={profile?.username ?? null} onDone={() => setEditing(false)} />
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[20px] font-semibold text-app-ink">{profile?.username ?? profile?.ens?.name ?? (shownId ? shortAddress(shownId) : "Profile")}</h1>
              {profile && (
                <button type="button" onClick={() => setEditing(true)} title={profile.username ? "Change username" : "Set a username"} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] text-app-muted hover:bg-app-selected/70 hover:text-app-ink">
                  <Pencil className="size-3.5" aria-hidden />
                  {profile.username ? "" : "Set username"}
                </button>
              )}
            </div>
          )}
          {!editing && (
            <p className="mt-0.5 truncate text-[12px] text-app-muted">
              {shownId ? shortAddress(shownId) : "Connect a wallet to start earning points"}
              {profile?.ens && profile.username && ` · ${profile.ens.name}`}
              {profile && ` · ${profile.level.name}`}
            </p>
          )}
        </div>
        {profile && (
          <dl className="flex gap-6 text-right">
            <div>
              <dt className="text-[11px] text-app-muted">Points</dt>
              <dd className="text-[18px] font-semibold tabular-nums text-app-ink">{number.format(profile.points)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-app-muted">Level</dt>
              <dd className="text-[18px] font-semibold tabular-nums text-app-ink">{profile.level.level}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-app-muted">Rank</dt>
              <dd className="text-[18px] font-semibold tabular-nums text-app-ink">{profile.rank ? `#${number.format(profile.rank)}` : "—"}</dd>
            </div>
          </dl>
        )}
      </div>
      <nav aria-label="Profile" className="-mb-px flex gap-5">
        {tabs.filter((entry) => entry.id !== "admin" || profile?.admin).map((entry) => (
          <Link
            key={entry.id}
            href={entry.href}
            aria-current={entry.id === tab ? "page" : undefined}
            className={`border-b-2 pb-2.5 text-[13px] font-semibold transition-colors ${entry.id === tab ? "border-app-accent text-app-ink" : "border-transparent text-app-muted hover:text-app-ink"}`}
          >
            {entry.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

function LevelCard() {
  const { profile } = useProfile();
  if (!profile) return null;
  const { level } = profile;
  return (
    <section className={`${card} h-full p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-app-ink">
          Level {level.level} · {level.name}
        </h2>
        <p className="text-[12px] tabular-nums text-app-muted">
          {level.next === null
            ? "Top level reached"
            : `${number.format(level.next - profile.points)} points to ${level.nextName}`}
        </p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-app-chip" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level.progress * 100)}>
        <div className="h-full rounded-full bg-app-accent transition-[width]" style={{ width: `${Math.max(2, level.progress * 100)}%` }} />
      </div>
      <ol className="mt-4 grid grid-cols-5 gap-1.5 text-center text-[10px]">
        {LEVELS.map((entry, index) => {
          const reached = index + 1 <= level.level;
          return (
            <li key={entry.name} title={`${number.format(entry.points)} points`} className={`rounded-lg px-1 py-1.5 ${index + 1 === level.level ? "bg-app-accent/15 text-app-ink" : reached ? "text-app-ink" : "text-app-faint"}`}>
              <span className="block font-semibold">{index + 1}</span>
              <span className="block truncate">{entry.name}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

type VolumeRange = "d7" | "d30" | "all";

const VOLUME_RANGES: Array<{ value: VolumeRange; label: string }> = [
  { value: "d7", label: "7D" },
  { value: "d30", label: "30D" },
  { value: "all", label: "All" },
];

/** A VIP tier's discount on Angler's perp fees (Hyperliquid, Lighter, Aster), in whole percent. */
const discountOf = (rate: number) => Math.round((1 - rate) * 100);

/** Volume through Angler on every venue together, over the last 7 or 30 days or all time. */
function VolumeCard({ profile }: { profile: ProfileData }) {
  const [range, setRange] = useState<VolumeRange>("all");
  const total = range === "all" ? VENUES.reduce((sum, venue) => sum + profile.volume[venue.id], 0) : profile.recentVolume[range];
  return (
    <section className={`${card} flex h-full flex-col justify-between gap-3 p-4`}>
      <div>
        <h2 className="text-[13px] font-semibold text-app-ink">Volume through Angler</h2>
        <p className="mt-1 text-[26px] font-semibold tabular-nums tracking-tight text-app-ink">{total >= 1_000_000 ? compactUsd.format(total) : usd.format(total)}</p>
      </div>
      <div role="group" aria-label="Period" className="flex gap-0.5 self-start rounded-lg bg-app-chip p-0.5">
        {VOLUME_RANGES.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={range === option.value}
            onClick={() => setRange(option.value)}
            className={`h-7 rounded-md px-2.5 text-[12px] font-semibold transition-colors ${range === option.value ? "bg-app-card text-app-ink shadow-xs" : "text-app-muted hover:text-app-ink"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}

/** VIP tiers: the tier your 30-day volume reached, the way to the next one, and the whole ladder. */
function VipCard({ profile }: { profile: ProfileData }) {
  const volume = profile.recentVolume.d30;
  const vip = vipFor(volume);
  const next = nextVip(vip);
  const progress = next ? Math.min(1, (volume - vip.minVolume) / (next.minVolume - vip.minVolume)) : 1;
  return (
    // The top tier's card glows on its own; the others light up toward the pointer.
    <BorderGlow className="h-full" backgroundColor="rgb(var(--app-card))" borderRadius={16} glowColor="accent" glowRadius={28} colors={["rgb(var(--app-accent))", "#e9b45a", "#fff1cf"]} fillOpacity={0.35} animated={!next}>
    <section className="flex h-full flex-col p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-app-ink">VIP</h2>
        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-wide ${vip.level > 0 ? "bg-app-accent/15 text-app-accent" : "bg-app-chip text-app-muted"}`}>
          VIP {vip.level}
        </span>
      </div>
      <p className="mt-1 text-[20px] font-semibold tracking-tight text-app-ink">{vip.level > 0 ? `${discountOf(vip.rate)}% off Angler perp fees` : "Trade more, pay less"}</p>
      <p className="mt-0.5 text-[12px] text-app-muted">
        {next
          ? `Trade ${compactUsd.format(Math.max(0, next.minVolume - volume))} more in 30 days to earn a ${discountOf(next.rate)}% perp fee discount.`
          : "Top tier: the biggest perp fee discount."}
      </p>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-app-chip" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <div className="h-full rounded-full bg-app-accent transition-[width]" style={{ width: `${Math.max(2, progress * 100)}%` }} />
      </div>
      <ol className="mt-auto grid grid-cols-5 gap-1.5 pt-3 text-center text-[10px]">
        {VIP_TIERS.map((tier) => (
          <li
            key={tier.level}
            title={`${compactUsd.format(tier.minVolume)}+ in 30 days`}
            className={`rounded-lg px-1 py-1.5 ${tier.level === vip.level ? "bg-app-accent/15 text-app-ink" : tier.level < vip.level ? "text-app-ink" : "text-app-faint"}`}
          >
            <span className="block font-semibold">VIP {tier.level}</span>
            <span className="block">{tier.level === 0 ? "—" : `-${discountOf(tier.rate)}%`}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11px] text-app-faint">On Hyperliquid, Lighter and Aster. Swaps and bridges charge everyone the same fee.</p>
    </section>
    </BorderGlow>
  );
}

function Overview() {
  const { id, profile, loading, error, linkSolana } = useProfile();
  const wallets = useWalletModal();
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  if (!id) {
    return (
      <section className={`${card} flex flex-col items-center gap-3 p-8 text-center`}>
        <Trophy className="size-8 text-app-muted" strokeWidth={1.5} aria-hidden />
        <h2 className="text-[16px] font-semibold text-app-ink">Earn points as you trade</h2>
        <p className="max-w-sm text-[13px] text-app-muted">A point for every $100 you trade through Angler. Level up from Minnow to Whale and climb the leaderboard.</p>
        <button type="button" onClick={wallets.open} className="mt-1 h-9 rounded-xl bg-app-accent px-4 text-[13px] font-semibold text-app-on-accent">
          Connect wallet
        </button>
      </section>
    );
  }
  if (!profile) return <p className="py-12 text-center text-[13px] text-app-muted">{error ?? (loading ? "Loading your profile…" : "")}</p>;

  return (
    <>
      {/* Level, volume and VIP side by side on wide screens. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <LevelCard />
        <VolumeCard profile={profile} />
        <VipCard profile={profile} />
      </div>
      {(profile.chain === "evm" && (profile.linkedWallets.length > 0 || linkSolana)) && (
        <section className={`${card} flex flex-wrap items-center gap-x-4 gap-y-2 p-4`}>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold text-app-ink">Solana wallets</h2>
            <p className="mt-0.5 text-[12px] text-app-muted">Swaps from a linked Solana wallet count toward this profile.</p>
          </div>
          {profile.linkedWallets.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {profile.linkedWallets.map((wallet) => (
                <li key={wallet} className="inline-flex items-center gap-1.5 rounded-lg bg-app-chip px-2 py-1 text-[12px] tabular-nums text-app-ink">
                  <Link2 className="size-3.5 text-app-muted" aria-hidden />
                  {shortAddress(wallet)}
                </li>
              ))}
            </ul>
          )}
          {linkSolana && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={linking}
                onClick={async () => {
                  setLinking(true);
                  setLinkError(await linkSolana());
                  setLinking(false);
                }}
                className="h-9 rounded-xl border border-app-hairline-strong px-3.5 text-[13px] font-semibold text-app-ink hover:bg-app-selected/70 disabled:opacity-60"
              >
                {linking ? "Sign in your Solana wallet…" : "Link connected Solana wallet"}
              </button>
              {linkError && <span className="text-[12px] text-app-down">{linkError}</span>}
            </div>
          )}
        </section>
      )}
      <DiscordRolesCard />
      <div className="grid gap-4 lg:grid-cols-2">
        <ReferralCard />
        <PortfolioCard className={`${card} h-full`} />
      </div>
      <section className={`${card} p-4 text-[12px] leading-relaxed text-app-muted`}>
        <h2 className="mb-1.5 text-[13px] font-semibold text-app-ink">How points work</h2>
        <ul className="list-disc space-y-1 pl-4">
          <li>10 points per $100,000 traded through Angler (0.01 per $100), on every venue the terminal routes to.</li>
          <li>Counted from the venues&apos; own records: Hyperliquid fills that carry Angler&apos;s builder fee, Lighter orders sent from the terminal, Aster trades with Angler&apos;s builder code, Orderly volume under Angler&apos;s broker (a day after it closes), Solana swaps that paid Angler&apos;s fee on-chain. Trading in other apps doesn&apos;t count.</li>
          <li>Lighter trades from a Standard account (which pays no trading fee) earn half points; Plus and Premium accounts earn full points. Your Lighter account card can switch to Plus.</li>
          <li>Closed beta: trades placed while the beta is closed earn {BETA_POINTS_MULTIPLIER}x points: 20 points per $100,000 (0.02 per $100), even when they show up here later. Once the beta opens, new trades go back to 10 per $100,000 (0.01 per $100); points already earned stay. Volume totals, VIP tiers and invites still count it once.</li>
          <li>Perp volume updates within a minute or two of a trade, swaps as soon as they confirm.</li>
          <li>Invites: every $10K you trade on perps and spot earns a single-use invite. You earn 10% of the Angler fees and 10% of the points of everyone who joins with one, from their perp and spot trades after they join (swaps and bridges don&apos;t count). Their own fees and points stay the same.</li>
        </ul>
      </section>
    </>
  );
}

/** Your invite codes (one per INVITE_VOLUME traded, single use) and referral stats; a referrer is set only through one (`AccessGate`). */
function ReferralCard() {
  const { id, profile, signIn, refresh } = useProfile();
  const [copied, setCopied] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [signing, setSigning] = useState(false);
  // The full list stays folded: at $1M of volume it's 100 codes. Codes handed out here move the featured one along.
  const [showAll, setShowAll] = useState(false);
  const [handed, setHanded] = useState<string[]>([]);
  const [signInError, setSignInError] = useState<string | null>(null);
  // Opened from the account menu's Referrals: scroll here once the card has rendered.
  useEffect(() => {
    if (profile && window.location.hash === "#referrals") document.getElementById("referrals")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [profile]);
  if (!id || !profile) return null;
  // Invite codes only reach their signed-in owner, so nobody can collect and burn someone else's.
  if (!profile.invites) {
    return (
      <section id="referrals" className={`${card} flex h-full scroll-mt-4 flex-col items-start p-4`}>
        <h2 className="text-[13px] font-semibold text-app-ink">Invites</h2>
        <p className="mt-1 text-[12px] text-app-muted">
          Every {compactUsd.format(INVITE_VOLUME)} you trade on perps and spot earns an invite. Each one brings in one trader: you earn 10% of the
          fees they pay and of their points on perp and spot trades.
        </p>
        <p className="mt-3 text-[12px] text-app-muted">Your invite codes are private. Sign in with your wallet to see them: one signature, no fee, good for 30 days.</p>
        <button
          type="button"
          disabled={signing}
          onClick={async () => {
            setSigning(true);
            setSignInError(await signIn());
            setSigning(false);
          }}
          className="mt-3 h-9 rounded-xl bg-app-accent px-4 text-[13px] font-semibold text-app-on-accent disabled:opacity-60"
        >
          {signing ? "Sign in your wallet…" : "Sign in to see invites"}
        </button>
        {signInError && <p className="mt-1.5 text-[12px] text-app-down">{signInError}</p>}
      </section>
    );
  }
  const { codes, nextAt, paused } = profile.invites;
  const unused = codes.filter((entry) => !entry.usedBy);
  const available = unused.length;
  const used = codes.length - available;
  // The next code to give: the first unused one not handed out in this visit (or the first unused once all were).
  const featured = unused.find((entry) => !handed.includes(entry.code)) ?? unused[0] ?? null;
  // Unused first, used ones last.
  const listed = [...unused, ...codes.filter((entry) => entry.usedBy)];
  // Invites come from perp and spot volume only (not swaps).
  const ownVolume = profile.volume.hyperliquid + profile.volume.lighter + profile.volume.lighterRh + profile.volume.aster + profile.volume.orderly;
  // `copied` is "link:CODE" or "code:CODE", so each button says "Copied" on its own.
  const copy = (code: string, what: "link" | "code") =>
    void navigator.clipboard?.writeText(what === "link" ? `${window.location.origin}/?ref=${code}` : code).then(() => {
      setCopied(`${what}:${code}`);
      window.setTimeout(() => {
        setCopied(null);
        setHanded((current) => (current.includes(code) ? current : [...current, code]));
      }, 1500);
    });
  const copyAll = () =>
    void navigator.clipboard?.writeText(unused.map((entry) => `${window.location.origin}/?ref=${entry.code}`).join("\n")).then(() => {
      setCopied("all");
      window.setTimeout(() => setCopied(null), 1500);
    });
  return (
    <section id="referrals" className={`${card} flex h-full scroll-mt-4 flex-col p-4`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-app-ink">
          Invites
          {profile.admin && <span className="rounded-md bg-app-accent/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-app-accent">Admin</span>}
        </h2>
        <span className="ml-auto rounded-md bg-app-chip px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-app-muted">
          {available} unused{used > 0 ? ` · ${used} used` : ""}
        </span>
        {profile.admin && (
          <button
            type="button"
            disabled={creating}
            onClick={async () => {
              setCreating(true);
              const response = await fetch("/api/profile/invites", { method: "POST" });
              const body = (await response.json().catch(() => ({}))) as { code?: string };
              if (body.code) void navigator.clipboard?.writeText(`${window.location.origin}/?ref=${body.code}`).then(() => setCopied(`link:${body.code}`));
              refresh();
              setCreating(false);
            }}
            title="Admins invite people into the closed beta; the new code's link is copied"
            className="h-7 rounded-lg bg-app-accent px-2.5 text-[12px] font-semibold text-app-on-accent hover:opacity-90 disabled:opacity-60"
          >
            {creating ? "Creating…" : "Create invite"}
          </button>
        )}
      </div>
      <p className="mt-1 text-[12px] text-app-muted">
        Every {compactUsd.format(INVITE_VOLUME)} you trade on perps and spot earns an invite. Each one brings in one trader: you earn 10% of the
        fees they pay and of their points on perp and spot trades.
      </p>
      {paused ? (
        // Closed beta: the team hands out invites; trading still counts toward the ones earned once it opens.
        <p className="mt-3 rounded-lg bg-app-chip/60 px-3 py-2.5 text-[12px] text-app-muted">
          During the closed beta only the Angler team hands out invites. Your volume still counts: when the beta opens you get one for every{" "}
          {compactUsd.format(INVITE_VOLUME)} you&apos;ve traded.
        </p>
      ) : codes.length > 0 ? (
        <>
          {featured ? (
            // The next code to hand out; the rest wait under "Show all".
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-app-chip/60 px-2.5 py-2">
              <span className="text-[11px] text-app-muted">Next invite</span>
              <code className="text-[14px] font-semibold tracking-wider text-app-ink">{featured.code}</code>
              <span className="ml-auto flex gap-1.5">
                <button
                  type="button"
                  onClick={() => copy(featured.code, "code")}
                  className="h-7 rounded-lg border border-app-hairline-strong px-2.5 text-[12px] font-semibold text-app-ink hover:bg-app-selected/70"
                >
                  {copied === `code:${featured.code}` ? "Copied" : "Copy code"}
                </button>
                <button
                  type="button"
                  onClick={() => copy(featured.code, "link")}
                  className="h-7 rounded-lg bg-app-accent px-2.5 text-[12px] font-semibold text-app-on-accent hover:opacity-90"
                >
                  {copied === `link:${featured.code}` ? "Copied" : "Copy link"}
                </button>
              </span>
            </div>
          ) : (
            <p className="mt-3 rounded-lg bg-app-chip/60 px-3 py-2.5 text-[12px] text-app-muted">Every invite has been used.</p>
          )}
          <div className="mt-1.5 flex items-center gap-3 text-[12px]">
            <button type="button" onClick={() => setShowAll((open) => !open)} aria-expanded={showAll} className="font-semibold text-app-muted hover:text-app-ink">
              {showAll ? "Hide all" : `Show all (${codes.length})`}
            </button>
            {available > 1 && (
              <button type="button" onClick={copyAll} title="Every unused invite link, one per line" className="font-semibold text-app-muted hover:text-app-ink">
                {copied === "all" ? "Copied" : `Copy all ${available} links`}
              </button>
            )}
          </div>
          {showAll && (
            <ul className="scrollbar-subtle mt-2 grid max-h-[180px] grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-3">
              {listed.map((entry) =>
                entry.usedBy ? (
                  <li key={entry.code} title={`Used by ${shortAddress(entry.usedBy)}`} className="flex items-center gap-1.5 rounded-lg bg-app-chip/30 px-2 py-1.5">
                    <code className="text-[12px] font-semibold tracking-wider text-app-faint line-through">{entry.code}</code>
                    <span className="ml-auto text-[10px] text-app-faint">Used</span>
                  </li>
                ) : (
                  <li key={entry.code}>
                    <button
                      type="button"
                      onClick={() => copy(entry.code, "link")}
                      title="Copy this invite's link"
                      className="flex w-full items-center gap-1.5 rounded-lg bg-app-chip/60 px-2 py-1.5 text-left hover:bg-app-selected/70"
                    >
                      <code className={`text-[12px] font-semibold tracking-wider ${handed.includes(entry.code) ? "text-app-muted" : "text-app-ink"}`}>{entry.code}</code>
                      <span className="ml-auto text-[10px] text-app-faint">{copied === `link:${entry.code}` ? "Copied" : handed.includes(entry.code) ? "Copied before" : "Copy"}</span>
                    </button>
                  </li>
                ),
              )}
            </ul>
          )}
        </>
      ) : (
        <p className="mt-3 rounded-lg bg-app-chip/60 px-3 py-2.5 text-[12px] text-app-muted">No invites yet.</p>
      )}
      <p className={`mt-1.5 text-[11px] text-app-faint ${paused ? "hidden" : ""}`}>Next invite at {compactUsd.format(nextAt)} of perp and spot volume ({compactUsd.format(Math.max(0, nextAt - ownVolume))} to go).</p>
      <div className="mt-auto grid grid-cols-3 gap-3 pt-3">
        <div className="rounded-xl bg-app-chip/60 px-3 py-2.5">
          <p className="text-[11px] text-app-muted">Referred</p>
          <p className="mt-0.5 text-[16px] font-semibold tabular-nums text-app-ink">{profile.referrals}</p>
        </div>
        <div className="rounded-xl bg-app-chip/60 px-3 py-2.5">
          <p className="text-[11px] text-app-muted">Referral points</p>
          <p className="mt-0.5 text-[16px] font-semibold tabular-nums text-app-ink">{number.format(profile.referralPoints)}</p>
        </div>
        <div
          className="rounded-xl bg-app-chip/60 px-3 py-2.5"
          title={`10% of the Angler fees your referrals paid on perp and spot trades: ${usd2.format(profile.referralEarnings)} earned, ${usd2.format(profile.referralPaid)} paid out`}
        >
          <p className="text-[11px] text-app-muted">Claimable</p>
          <p className="mt-0.5 text-[16px] font-semibold tabular-nums text-app-up">{usd2.format(profile.referralClaimable)}</p>
        </div>
      </div>
      {profile.referralEarnings > 0 && (
        <p className="mt-1.5 text-[11px] tabular-nums text-app-faint">
          {usd2.format(profile.referralEarnings)} earned all time · {usd2.format(profile.referralPaid)} paid out
        </p>
      )}
      {profile.referralClaimable > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-app-up/25 bg-app-up/[0.06] px-3 py-2.5">
          <p className="min-w-0 flex-1 text-[12px] text-app-muted">
            To withdraw your <span className="font-semibold text-app-up">{usd2.format(profile.referralClaimable)}</span>, open a ticket on our Discord with your wallet address.
          </p>
          {DISCORD_URL && (
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[#5865F2] px-3 text-[12px] font-semibold text-white hover:opacity-90"
            >
              Open a ticket
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </div>
      )}
      {profile.referrer && <p className="mt-3 text-[12px] text-app-muted">Invited by {shortAddress(profile.referrer)}.</p>}
    </section>
  );
}

function Leaderboard() {
  const { profile } = useProfile();
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/leaderboard")
      .then(async (response) => {
        const body = (await response.json()) as { entries?: LeaderboardEntry[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? `Leaderboard failed (${response.status}).`);
        if (!cancelled) setEntries(body.entries ?? []);
      })
      .catch((failure) => !cancelled && setError(failure instanceof Error ? failure.message : String(failure)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="py-12 text-center text-[13px] text-app-down">{error}</p>;
  if (!entries) return <p className="py-12 text-center text-[13px] text-app-muted">Loading the leaderboard…</p>;
  if (entries.length === 0) return <p className="py-12 text-center text-[13px] text-app-muted">No points yet. The first trade through Angler takes the top spot.</p>;

  const th = "px-3 py-2 text-left text-[11px] font-medium text-app-muted";
  const td = "px-3 py-2 tabular-nums";
  return (
    <section className={`${card} overflow-hidden`}>
      <div className="scrollbar-subtle overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-app-hairline">
              <th className={`${th} w-14`}>#</th>
              <th className={th}>Trader</th>
              <th className={th}>Level</th>
              <th className={`${th} text-right`}>Points</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const mine = entry.id === profile?.id;
              return (
                <tr key={entry.id} className={`border-t border-app-hairline first:border-t-0 ${mine ? "bg-app-accent/10" : ""}`}>
                  <td className={`${td} font-semibold ${entry.rank <= 3 ? "text-app-accent" : "text-app-muted"}`}>{entry.rank}</td>
                  <td className={td}>
                    <span className="flex items-center gap-2 text-app-ink">
                      <ProfileAvatar id={entry.id} size={20} image={entry.ens?.avatar} />
                      <span className="truncate font-medium">{entry.username ?? entry.ens?.name ?? shortAddress(entry.id)}</span>
                      {mine && <span className="text-[11px] text-app-muted">you</span>}
                    </span>
                  </td>
                  <td className={`${td} text-app-muted`}>
                    {entry.level} · {entry.levelName}
                  </td>
                  <td className={`${td} text-right font-semibold text-app-ink`}>{number.format(entry.points)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The profile page: who you are on Angler (username, points, level), your portfolio and the leaderboard. */
export function ProfileView({ tab }: { tab: ProfileTab }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <ProfileHeader tab={tab} />
      {tab === "portfolio" ? (
        <div className="min-h-0 flex-1">
          <PortfolioView />
        </div>
      ) : (
        // Vertical scroll only: BorderGlow's glow layer reaches past the cards' edges and used to add a sideways scroll.
        <section className="surface-panel scrollbar-subtle flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden *:shrink-0 rounded-2xl border border-app-card/80 bg-app-card/55 p-4 sm:p-5">
          {tab === "leaderboard" ? <Leaderboard /> : tab === "admin" ? <AdminView invites={<ReferralCard />} /> : tab === "rewards" ? <RewardsView /> : tab === "alerts" ? <AlertsView /> : <Overview />}
        </section>
      )}
    </div>
  );
}
