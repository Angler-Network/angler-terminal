"use client";

import { Bell, BellOff, Check, Copy as CopyGlyph, ExternalLink, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { SegmentedControl, Toggle } from "@/components/app/form-controls";
import { LoadingState } from "@/components/app/loading-state";
import { MarketIcon } from "@/components/app/market-icon";
import { SelectField } from "@/components/app/select-field";
import { useToast } from "@/components/app/toast-provider";
import { useProfile } from "@/components/profile/profile-provider";
import { useTrading } from "@/components/terminal/trading-provider";
import { minOrderUsd } from "@/components/terminal/use-best-execution";
import { VenueLogo } from "@/components/terminal/venue-logo";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { useWallet } from "@/components/terminal/wallet-provider";
import { trackPerpOrder } from "@/lib/analytics/client";
import { coinSymbol } from "@/lib/copy/events";
import { addLog, forgetHoldings, loadBook, loadFollows, loadLog, recordFill, subscribeCopyStore, updateFollows, type CopyHolding, type CopyLogEntry } from "@/lib/copy/follow-store";
import {
  DEFAULT_COPY,
  FOLLOW_SOURCE_NAMES,
  FOLLOW_SOURCES,
  MAX_COPYING,
  MAX_FOLLOWS,
  MAX_LABEL,
  followId,
  followName,
  readFollow,
  shortAddress,
  type CopySettings,
  type CopyTarget,
  type Follow,
  type FollowSource,
} from "@/lib/copy/follows";
import { loadLeader, loadLeaderFills, type LeaderFill, type LeaderSnapshot } from "@/lib/copy/leader-client";
import { formatPrice } from "@/lib/format";
import { findMarket } from "@/lib/venues/hyperliquid/markets";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId } from "@/lib/venues/types";

const card = "rounded-2xl border border-app-hairline bg-app-card/60";
const field = "h-9 min-w-0 rounded-lg border border-app-field-border bg-app-field px-2.5 text-[13px] tabular-nums text-app-ink outline-hidden placeholder:text-app-faint focus:border-app-ink";
const button = "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition-opacity disabled:opacity-50";
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const compactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const LEADER_REFRESH_MS = 15_000;
const TARGETS: Array<{ value: CopyTarget; label: string }> = [
  { value: "same", label: "Same venue as the wallet" },
  { value: "best", label: "Best price across venues" },
  ...(Object.keys(PERP_VENUE_NAMES) as PerpVenueId[]).map((venue) => ({ value: venue as CopyTarget, label: `Always ${PERP_VENUE_NAMES[venue]}` })),
];

const signedUsd = (value: number) => `${value >= 0 ? "+" : "−"}${usd.format(Math.abs(value))}`;
const timeAgo = (at: number) => {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
};

/** The follow list, holdings and log of this wallet, live across tabs. */
function useCopyStore(address: string | null) {
  const [state, setState] = useState<{ follows: Follow[]; book: Record<string, CopyHolding>; log: CopyLogEntry[] }>({ follows: [], book: {}, log: [] });
  useEffect(() => {
    if (!address) return setState({ follows: [], book: {}, log: [] });
    const read = () => setState({ follows: loadFollows(address), book: loadBook(address), log: loadLog(address) });
    read();
    return subscribeCopyStore(read);
  }, [address]);
  return state;
}

type AlertsStatus = "loading" | "signin" | "ready" | "error";

/** The profile's alert channels and the server's list of wallets to message about. */
function useFollowAlerts(address: string | null, follows: Follow[]) {
  const { signIn } = useProfile();
  const toast = useToast();
  const [status, setStatus] = useState<AlertsStatus>("loading");
  const [channel, setChannel] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!address) return;
    let active = true;
    setStatus("loading");
    fetch("/api/alerts", { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) return setStatus("signin");
        if (!response.ok) return setStatus("error");
        const body = (await response.json()) as { settings: { discordWebhook: string | null; telegramChatId: string | null; follows?: Array<{ source: FollowSource; address: string; label: string }> } };
        setChannel(Boolean(body.settings.discordWebhook || body.settings.telegramChatId));
        // Wallets this profile gets alerts about from another browser join this list.
        const remote = body.settings.follows ?? [];
        if (remote.length) {
          updateFollows(address, (list) => {
            const next = [...list];
            for (const wallet of remote) {
              const id = followId(wallet.source, wallet.address);
              const existing = next.find((follow) => follow.id === id);
              if (existing) existing.notify = true;
              else {
                const follow = readFollow({ ...wallet, addedAt: Date.now(), notify: true });
                if (follow) next.push(follow);
              }
            }
            return next;
          });
        }
        setStatus("ready");
      })
      .catch(() => active && setStatus("error"));
    return () => {
      active = false;
    };
  }, [address, attempt]);

  const sync = useCallback(
    async (list: Follow[]) => {
      const watched = list.filter((follow) => follow.notify).map(({ source, address: wallet, label }) => ({ source, address: wallet, label }));
      const response = await fetch("/api/alerts/follows", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ follows: watched }) }).catch(() => null);
      if (response?.status === 401) {
        setStatus("signin");
        return false;
      }
      const body = (await response?.json().catch(() => null)) as { channel?: boolean; error?: string } | null;
      if (!response?.ok) {
        toast({ tone: "error", title: "Couldn't save alerts", message: body?.error });
        return false;
      }
      setChannel(Boolean(body?.channel));
      return true;
    },
    [toast],
  );

  const signInAndRetry = useCallback(async () => {
    const id = await signIn();
    if (id) setAttempt((value) => value + 1);
    return Boolean(id);
  }, [signIn]);

  // Keep the server's list in step with this browser's switches once alerts are reachable.
  const notifyKey = follows.filter((follow) => follow.notify).map((follow) => `${follow.id}:${follow.label}`).join(",");
  useEffect(() => {
    if (status !== "ready" || !address) return;
    void sync(loadFollows(address));
  }, [notifyKey, status, address, sync]);

  return { status, channel, signIn: signInAndRetry };
}

/** A followed wallet's positions, refreshed while the page is open and visible. */
function useLeader(follow: Follow) {
  const [snapshot, setSnapshot] = useState<LeaderSnapshot | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () =>
      loadLeader(follow.source, follow.address)
        .then((value) => {
          if (!active) return;
          setSnapshot(value);
          setError(false);
        })
        .catch(() => active && setError(true));
    void load();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void load(), LEADER_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [follow.source, follow.address]);
  return { snapshot, error };
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className={`${card} p-4`}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[14px] font-semibold text-app-ink">{title}</h2>
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  );
}

function AddWallet({ address, count }: { address: string; count: number }) {
  const toast = useToast();
  const [wallet, setWallet] = useState("");
  const [source, setSource] = useState<FollowSource>("hyperliquid");
  const [label, setLabel] = useState("");
  const add = () => {
    const follow = readFollow({ source, address: wallet.trim(), label, addedAt: Date.now() });
    if (!follow) return toast({ tone: "error", title: "That isn't a wallet address", message: "Paste a 0x address (42 characters)." });
    if (follow.address === address.toLowerCase()) return toast({ tone: "error", title: "That's your own wallet" });
    if (loadFollows(address).some((entry) => entry.id === follow.id)) return toast({ tone: "error", title: "Already followed" });
    if (count >= MAX_FOLLOWS) return toast({ tone: "error", title: `Follow up to ${MAX_FOLLOWS} wallets`, message: "Remove one first." });
    updateFollows(address, (list) => [...list, follow]);
    setWallet("");
    setLabel("");
  };
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <input value={wallet} onChange={(event) => setWallet(event.target.value)} placeholder="Wallet address (0x…)" aria-label="Wallet address" className={`${field} min-w-[16rem] flex-[2]`} />
      <SelectField<FollowSource> size="sm" label="Venue" value={source} onChange={setSource} options={FOLLOW_SOURCES.map((value) => ({ value, label: FOLLOW_SOURCE_NAMES[value] }))} />
      <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={MAX_LABEL} placeholder="Name (optional)" aria-label="Name" className={`${field} min-w-[8rem] flex-1`} />
      <button type="submit" className={`${button} h-9 bg-app-accent text-app-on-accent hover:opacity-90`}>
        Follow
      </button>
    </form>
  );
}

function CopySettingsForm({ follow, address }: { follow: Follow; address: string }) {
  const [draft, setDraft] = useState<CopySettings>(follow.copy);
  const [coins, setCoins] = useState(follow.copy.coins.join(", "));
  useEffect(() => {
    setDraft(follow.copy);
    setCoins(follow.copy.coins.join(", "));
  }, [follow.copy]);
  const save = (patch: Partial<CopySettings>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    updateFollows(address, (list) => list.map((entry) => (entry.id === follow.id ? { ...entry, copy: { ...next, enabled: entry.copy.enabled } } : entry)));
  };
  const number = (value: string) => (value === "" ? NaN : Number(value));
  return (
    <div className="grid gap-3 rounded-xl bg-app-chip/40 p-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-[11px] text-app-muted">
        Size per copied position
        <span className="flex items-center gap-2">
          <SegmentedControl
            label="Sizing"
            value={draft.sizing}
            onChange={(sizing) => save({ sizing })}
            options={[
              { value: "fixed", label: "Fixed $" },
              { value: "ratio", label: "% of wallet" },
            ]}
          />
          <input
            type="number"
            min={draft.sizing === "fixed" ? 1 : 0.01}
            step="any"
            defaultValue={draft.sizing === "fixed" ? draft.usd : draft.ratio}
            key={draft.sizing}
            onBlur={(event) => {
              const value = number(event.target.value);
              if (Number.isFinite(value) && value > 0) save(draft.sizing === "fixed" ? { usd: value } : { ratio: value });
            }}
            aria-label={draft.sizing === "fixed" ? "USD per position" : "Percent of the wallet's size"}
            className={`${field} w-24`}
          />
          <span className="text-[12px] text-app-muted">{draft.sizing === "fixed" ? "USD" : "%"}</span>
        </span>
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-app-muted">
        Cap per position (USD)
        <input
          type="number"
          min={1}
          defaultValue={draft.maxUsd}
          onBlur={(event) => {
            const value = number(event.target.value);
            if (Number.isFinite(value) && value > 0) save({ maxUsd: value });
          }}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-app-muted">
        Leverage
        <input
          type="number"
          min={1}
          max={50}
          defaultValue={draft.leverage}
          onBlur={(event) => {
            const value = number(event.target.value);
            if (Number.isFinite(value) && value >= 1) save({ leverage: Math.round(value) });
          }}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-app-muted">
        Copy on
        <SelectField<CopyTarget> size="sm" label="Copy venue" value={draft.target} onChange={(target) => save({ target })} options={TARGETS} />
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-app-muted sm:col-span-2">
        Only these coins (empty copies every coin)
        <input
          value={coins}
          onChange={(event) => setCoins(event.target.value)}
          onBlur={() => save({ coins: coins.split(/[\s,]+/).filter(Boolean).map((coin) => coin.toUpperCase()) })}
          placeholder="BTC, ETH, SOL"
          className={field}
        />
      </label>
      <p className="text-[11px] leading-relaxed text-app-faint sm:col-span-2">
        New positions are copied at your size; adds, reductions and closes follow the wallet in proportion. Positions it already held are left alone. Copies run
        only while an Angler tab is open (your trading keys never leave this browser); alerts keep coming with it closed.
      </p>
    </div>
  );
}

function PositionsTable({ snapshot, holdings }: { snapshot: LeaderSnapshot; holdings: Record<string, CopyHolding> }) {
  const rows = Object.values(snapshot.positions).sort((a, b) => Math.abs(b.size * b.markPx) - Math.abs(a.size * a.markPx));
  if (rows.length === 0) return <p className="py-2 text-[12px] text-app-muted">No open positions.</p>;
  return (
    <div className="scrollbar-subtle overflow-x-auto">
      <table className="w-full min-w-[520px] text-[12px] tabular-nums">
        <thead>
          <tr className="text-left text-[11px] text-app-faint">
            <th className="py-1 pr-2 font-medium">Coin</th>
            <th className="py-1 pr-2 text-right font-medium">Size</th>
            <th className="py-1 pr-2 text-right font-medium">Value</th>
            <th className="py-1 pr-2 text-right font-medium">Entry</th>
            <th className="py-1 pr-2 text-right font-medium">uPnL</th>
            <th className="py-1 text-right font-medium">Your copy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((position) => {
            const symbol = coinSymbol(position.coin);
            const held = holdings[position.coin];
            return (
              <tr key={position.coin} className="border-t border-app-hairline">
                <td className="py-1.5 pr-2">
                  <span className="flex items-center gap-1.5 font-semibold text-app-ink">
                    <MarketIcon symbol={symbol} size={16} />
                    {symbol}
                    <span className={position.size > 0 ? "text-app-up" : "text-app-down"}>{position.size > 0 ? "Long" : "Short"}</span>
                    {position.leverage && <span className="font-normal text-app-faint">{position.leverage}x</span>}
                  </span>
                </td>
                <td className="py-1.5 pr-2 text-right text-app-ink">{Number(Math.abs(position.size).toPrecision(6))}</td>
                <td className="py-1.5 pr-2 text-right text-app-ink">{compactUsd.format(Math.abs(position.size) * position.markPx)}</td>
                <td className="py-1.5 pr-2 text-right text-app-muted">{formatPrice(position.entryPx)}</td>
                <td className={`py-1.5 pr-2 text-right ${position.unrealizedPnl >= 0 ? "text-app-up" : "text-app-down"}`}>{signedUsd(position.unrealizedPnl)}</td>
                <td className="py-1.5 text-right text-app-muted">
                  {held ? `${Number(Math.abs(held.size).toPrecision(6))} on ${PERP_VENUE_NAMES[held.venue as PerpVenueId] ?? held.venue}` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecentFills({ follow }: { follow: Follow }) {
  const [fills, setFills] = useState<LeaderFill[] | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    loadLeaderFills(follow.source, follow.address)
      .then((value) => active && setFills(value))
      .catch(() => active && setFills([]));
    return () => {
      active = false;
    };
  }, [follow.source, follow.address]);
  if (fills === undefined) return <p className="text-[12px] text-app-muted">Loading trades…</p>;
  if (fills === null) return <p className="text-[12px] text-app-muted">{FOLLOW_SOURCE_NAMES[follow.source]} shows an account&apos;s trades only to its owner; positions above update live.</p>;
  if (fills.length === 0) return <p className="text-[12px] text-app-muted">No recent trades.</p>;
  return (
    <ul className="flex flex-col gap-1 text-[12px] tabular-nums">
      {fills.map((fill, index) => (
        <li key={`${fill.time}-${index}`} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-app-faint">{timeAgo(fill.time)}</span>
          <span className={fill.side === "buy" ? "text-app-up" : "text-app-down"}>{fill.dir}</span>
          <span className="font-semibold text-app-ink">{coinSymbol(fill.coin)}</span>
          <span className="text-app-muted">
            {Number(fill.size.toPrecision(6))} @ {formatPrice(fill.price)}
          </span>
          {fill.closedPnl !== 0 && <span className={`ml-auto ${fill.closedPnl >= 0 ? "text-app-up" : "text-app-down"}`}>{signedUsd(fill.closedPnl)}</span>}
        </li>
      ))}
    </ul>
  );
}

function FollowCard({
  follow,
  address,
  holdings,
  copyingCount,
  onNotify,
}: {
  follow: Follow;
  address: string;
  holdings: Record<string, CopyHolding>;
  copyingCount: number;
  onNotify: (follow: Follow, on: boolean) => void;
}) {
  const toast = useToast();
  const { snapshot, error } = useLeader(follow);
  const [showFills, setShowFills] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [copied, setCopied] = useState(false);
  const positions = snapshot ? Object.values(snapshot.positions) : [];
  const upnl = positions.reduce((sum, position) => sum + position.unrealizedPnl, 0);
  const exposure = positions.reduce((sum, position) => sum + Math.abs(position.size * position.markPx), 0);
  const explorer = follow.source === "hyperliquid" ? `https://app.hyperliquid.xyz/explorer/address/${follow.address}` : null;

  const setCopy = (enabled: boolean) => {
    if (enabled && copyingCount >= MAX_COPYING) return toast({ tone: "error", title: `Copy up to ${MAX_COPYING} wallets at once`, message: "Turn one off first." });
    updateFollows(address, (list) => list.map((entry) => (entry.id === follow.id ? { ...entry, copy: { ...entry.copy, enabled } } : entry)));
    if (enabled) toast({ tone: "success", title: `Copying ${followName(follow)}`, message: "From its next trade on. Keep an Angler tab open." });
  };

  return (
    <article className={`${card} flex flex-col gap-3 p-4`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <VenueLogo name={FOLLOW_SOURCE_NAMES[follow.source]} size={22} />
        <div className="min-w-0">
          <h3 className="truncate text-[14px] font-semibold text-app-ink">{followName(follow)}</h3>
          <p className="flex items-center gap-1.5 text-[11px] text-app-faint">
            {FOLLOW_SOURCE_NAMES[follow.source]} · {shortAddress(follow.address)}
            <button
              type="button"
              title="Copy the address"
              aria-label="Copy the address"
              onClick={() => {
                void navigator.clipboard?.writeText(follow.address).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1200);
                });
              }}
              className="hover:text-app-ink"
            >
              {copied ? <Check className="size-3" /> : <CopyGlyph className="size-3" />}
            </button>
            {explorer && (
              <a href={explorer} target="_blank" rel="noopener noreferrer" title="Open in the explorer" className="hover:text-app-ink">
                <ExternalLink className="size-3" />
              </a>
            )}
          </p>
        </div>
        <dl className="flex gap-4 text-[12px] tabular-nums">
          <div>
            <dt className="text-[11px] text-app-faint">Account</dt>
            <dd className="font-semibold text-app-ink">{snapshot?.accountValue != null ? compactUsd.format(snapshot.accountValue) : "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-app-faint">Exposure</dt>
            <dd className="font-semibold text-app-ink">{snapshot ? compactUsd.format(exposure) : "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-app-faint">uPnL</dt>
            <dd className={`font-semibold ${upnl >= 0 ? "text-app-up" : "text-app-down"}`}>{snapshot ? signedUsd(upnl) : "—"}</dd>
          </div>
        </dl>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => onNotify(follow, !follow.notify)}
            title={follow.notify ? "Telegram / Discord alerts on" : "Get Telegram / Discord alerts when it trades"}
            className={`${button} ${follow.notify ? "bg-app-accent/15 text-app-accent" : "bg-app-chip text-app-muted hover:text-app-ink"}`}
          >
            {follow.notify ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}
            Alerts
          </button>
          <span className="flex items-center gap-2 text-[12px] font-semibold text-app-muted">
            Copy
            <Toggle label={`Copy ${followName(follow)}`} checked={follow.copy.enabled} onChange={setCopy} />
          </span>
          <button
            type="button"
            onClick={() => {
              if (!confirmRemove) {
                setConfirmRemove(true);
                window.setTimeout(() => setConfirmRemove(false), 3000);
                return;
              }
              forgetHoldings(address, follow.id);
              updateFollows(address, (list) => list.filter((entry) => entry.id !== follow.id));
            }}
            title="Stop following (your copied positions stay open)"
            className={`${button} ${confirmRemove ? "bg-app-down/15 text-app-down" : "text-app-faint hover:text-app-ink"}`}
          >
            <Trash2 className="size-3.5" />
            {confirmRemove ? "Remove?" : ""}
          </button>
        </div>
      </header>

      {error && !snapshot ? (
        <p className="text-[12px] text-app-down">Couldn&apos;t read this wallet right now.</p>
      ) : snapshot ? (
        <PositionsTable snapshot={snapshot} holdings={holdings} />
      ) : (
        <LoadingState label="Reading positions…" compact />
      )}

      {follow.copy.enabled && <CopySettingsForm follow={follow} address={address} />}

      <div>
        <button type="button" onClick={() => setShowFills((value) => !value)} className="text-[12px] font-semibold text-app-muted hover:text-app-ink">
          {showFills ? "Hide recent trades" : "Recent trades"}
        </button>
        {showFills && (
          <div className="mt-2">
            <RecentFills follow={follow} />
          </div>
        )}
      </div>
    </article>
  );
}

/** "Copy this trade", opened from an alert's link: the coin and side the wallet just traded, at the follower's size. */
function TradeOffer({ address, follows }: { address: `0x${string}`; follows: Follow[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const { marketsByVenue, perpOrder, placeOrder, isVenueReady } = useTrading();
  const offer = useMemo(() => {
    const id = params.get("follow") ?? "";
    const coin = params.get("coin") ?? "";
    const side = params.get("side");
    if (!coin || (side !== "long" && side !== "short") || !/^[A-Za-z0-9:]{1,30}$/.test(coin)) return null;
    const [source, wallet] = id.split(":");
    return { id, source: source as FollowSource, wallet: wallet ?? "", coin, side } as const;
  }, [params]);
  const follow = follows.find((entry) => entry.id === offer?.id) ?? null;
  const symbol = offer ? coinSymbol(offer.coin) : "";
  const venues = useMemo(
    () => perpOrder.filter((venue) => marketsByVenue[venue] && (venue === offer?.source ? findMarket(marketsByVenue[venue]!, offer.coin) : findMarket(marketsByVenue[venue]!, symbol))),
    [perpOrder, marketsByVenue, offer, symbol],
  );
  const [venue, setVenue] = useState<PerpVenueId | null>(null);
  const [amount, setAmount] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAmount(String(follow?.copy.sizing === "fixed" ? follow.copy.usd : DEFAULT_COPY.usd));
  }, [follow]);
  const chosen = venue && venues.includes(venue) ? venue : venues.includes(offer?.source as PerpVenueId) ? (offer!.source as PerpVenueId) : (venues[0] ?? null);
  if (!offer) return null;
  const market = chosen && marketsByVenue[chosen] ? (chosen === offer.source ? findMarket(marketsByVenue[chosen]!, offer.coin) : findMarket(marketsByVenue[chosen]!, symbol)) : null;
  const value = Number(amount);
  const price = market?.midPx ?? market?.markPx ?? 0;
  const tooSmall = market && value > 0 && value < minOrderUsd(market);
  const close = () => router.replace("/copy");

  const place = async () => {
    if (!market || !(value > 0) || !price) return;
    if (!armed) return setArmed(true);
    setBusy(true);
    const side = offer.side === "long" ? "buy" : "sell";
    const size = Math.floor((value / price) * 10 ** market.szDecimals) / 10 ** market.szDecimals;
    const result = await placeOrder({ market, side, kind: "market", size, leverage: Math.min(follow?.copy.leverage ?? DEFAULT_COPY.leverage, market.maxLeverage), isCross: !market.onlyIsolated });
    setBusy(false);
    setArmed(false);
    if (result?.status === "filled") {
      trackPerpOrder(result, { venue: market.venue, side, newsId: null, oneClick: false });
      if (follow) {
        recordFill(address, follow.id, offer.coin, market.venue, market.coin, side === "buy" ? result.filledSize : -result.filledSize);
        addLog(address, { followId: follow.id, tone: "success", text: `${followName(follow)}: copied by hand, ${side === "buy" ? "bought" : "sold"} ${result.filledSize} ${symbol} on ${PERP_VENUE_NAMES[market.venue]}.` });
      }
      close();
    }
  };

  return (
    <section className={`${card} flex flex-col gap-3 border-app-accent/40 p-4`}>
      <header className="flex items-center gap-2">
        <MarketIcon symbol={symbol} size={22} />
        <h2 className="text-[14px] font-semibold text-app-ink">
          Copy {follow ? followName(follow) : shortAddress(offer.wallet || "0x0000000000")}&apos;s{" "}
          <span className={offer.side === "long" ? "text-app-up" : "text-app-down"}>{offer.side}</span> {symbol}
        </h2>
        <button type="button" onClick={close} aria-label="Close" className="ml-auto text-app-faint hover:text-app-ink">
          <X className="size-4" />
        </button>
      </header>
      {venues.length === 0 ? (
        <p className="text-[12px] text-app-muted">{symbol} isn&apos;t listed on any venue you have on.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-9 items-center rounded-lg border border-app-field-border bg-app-field px-2.5">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value.replace(/[^0-9.]/g, ""));
                setArmed(false);
              }}
              aria-label="Amount in USD"
              className="w-24 bg-transparent text-[13px] tabular-nums text-app-ink outline-hidden"
            />
            <span className="text-[12px] text-app-muted">USD</span>
          </span>
          <SelectField<PerpVenueId>
            size="sm"
            label="Venue"
            value={chosen ?? venues[0]}
            onChange={(next) => {
              setVenue(next);
              setArmed(false);
            }}
            options={venues.map((id) => ({ value: id, label: `${PERP_VENUE_NAMES[id]}${isVenueReady(id) ? "" : " (set up)"}` }))}
          />
          <button
            type="button"
            disabled={busy || !market || !(value > 0) || Boolean(tooSmall)}
            onClick={() => void place()}
            className={`${button} h-9 ${offer.side === "long" ? "bg-app-up text-black" : "bg-app-down text-white"} hover:opacity-90`}
          >
            {busy ? "Placing…" : armed ? "Confirm" : `${offer.side === "long" ? "Long" : "Short"} ${symbol}`}
          </button>
          {tooSmall && <span className="text-[12px] text-app-down">Under {PERP_VENUE_NAMES[market!.venue]}&apos;s minimum.</span>}
        </div>
      )}
      {!follow && offer.source && offer.wallet && <p className="text-[11px] text-app-faint">You don&apos;t follow this wallet in this browser.</p>}
    </section>
  );
}

/**
 * Copy trading (`/copy`): follow Hyperliquid and Lighter wallets (their positions are public), get Telegram or Discord
 * alerts when they trade (sent by the server, `lib/alerts/tick.ts`) and copy them on any perp venue while a tab is open
 * (`copy-runner.tsx`). The list lives in this browser; only the wallets with alerts on are kept on the server.
 */
export function CopyView() {
  const { address } = useWallet();
  const { open: openWallets } = useWalletModal();
  const toast = useToast();
  const { follows, book, log } = useCopyStore(address);
  const alerts = useFollowAlerts(address, follows);
  const copying = follows.filter((follow) => follow.copy.enabled).length;

  const holdingsOf = (follow: Follow) => {
    const prefix = `${follow.id}|`;
    return Object.fromEntries(Object.entries(book).flatMap(([key, holding]) => (key.startsWith(prefix) ? [[key.slice(prefix.length), holding]] : [])));
  };

  const onNotify = async (follow: Follow, on: boolean) => {
    if (!address) return;
    if (on && alerts.status === "signin" && !(await alerts.signIn())) return;
    updateFollows(address, (list) => list.map((entry) => (entry.id === follow.id ? { ...entry, notify: on } : entry)));
    if (on && alerts.status === "ready" && !alerts.channel) {
      toast({ tone: "info", title: "Connect Telegram or Discord", message: "Alerts go to the channels set in Profile → Alerts." });
    }
  };

  return (
    <section className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-app-hairline px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-[16px] font-semibold text-app-ink">Copy trading</h1>
          <p className="text-[12px] text-app-muted">
            Follow Hyperliquid and Lighter wallets, get alerts when they trade, and copy them on any perp venue. You keep your own positions; no profit share.
          </p>
        </div>
      </header>
      <div className="scrollbar-subtle flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {!address ? (
          <div className={`${card} flex flex-col items-start gap-3 p-5`}>
            <p className="text-[13px] text-app-muted">Connect a wallet to follow and copy other wallets.</p>
            <button type="button" onClick={() => openWallets()} className={`${button} h-9 bg-app-accent text-app-on-accent`}>
              Connect wallet
            </button>
          </div>
        ) : (
          <>
            <TradeOffer address={address} follows={follows} />
            <Section
              title={`Follow a wallet (${follows.length}/${MAX_FOLLOWS})`}
              action={
                alerts.status === "signin" ? (
                  <button type="button" onClick={() => void alerts.signIn()} className={`${button} bg-app-chip text-app-ink`}>
                    Sign in for alerts
                  </button>
                ) : alerts.status === "ready" && !alerts.channel && follows.some((follow) => follow.notify) ? (
                  <Link href="/profile/alerts" className="text-[12px] font-semibold text-app-accent hover:underline">
                    Connect Telegram / Discord
                  </Link>
                ) : null
              }
            >
              <AddWallet address={address} count={follows.length} />
              <p className="mt-2 text-[11px] text-app-faint">
                Positions are public on Hyperliquid and Lighter; Aster and Orderly don&apos;t show them, so their wallets can&apos;t be followed. Copies can still go to any
                venue.
              </p>
            </Section>

            {follows.map((follow) => (
              <FollowCard key={follow.id} follow={follow} address={address} holdings={holdingsOf(follow)} copyingCount={copying} onNotify={(entry, on) => void onNotify(entry, on)} />
            ))}

            {log.length > 0 && (
              <Section title="Copy activity">
                <ul className="flex flex-col gap-1.5 text-[12px]">
                  {log.slice(0, 30).map((entry, index) => (
                    <li key={`${entry.at}-${index}`} className="flex gap-2">
                      <span className="w-16 shrink-0 tabular-nums text-app-faint">{timeAgo(entry.at)}</span>
                      <span className={entry.tone === "success" ? "text-app-ink" : entry.tone === "error" ? "text-app-down" : "text-app-muted"}>{entry.text}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}
      </div>
    </section>
  );
}
