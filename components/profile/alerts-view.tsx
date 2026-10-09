"use client";

import { Bell, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SelectField, SettingRow, Toggle } from "@/components/app/form-controls";
import { useToast } from "@/components/app/toast-provider";
import { displayCoin } from "@/lib/alerts/rules";
import {
  DEFAULT_ALERT_SETTINGS,
  LIQUIDATION_STEPS,
  MAX_PRICE_ALERTS,
  NEWS_IMPACT_STEPS,
  isDiscordWebhook,
  normalizeCoin,
  type AlertSettings,
  type PriceAlert,
} from "@/lib/alerts/settings";
import { formatPrice } from "@/lib/format";
import { useProfile } from "./profile-provider";

const card = "rounded-2xl border border-app-hairline bg-app-card/60";
const field = "h-9 w-full rounded-lg border border-app-field-border bg-app-field px-2.5 text-[13px] text-app-ink outline-hidden placeholder:text-app-faint focus:border-app-ink";
const button = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:opacity-50";

type Loaded = { settings: AlertSettings; fired: string[]; telegram: boolean; evm: boolean };

const offOr = (steps: readonly number[], unit: string) => [{ value: "off", label: "Off" }, ...steps.map((step) => ({ value: String(step), label: `${step}${unit}` }))];

/** Price alert entry: coin, above/below, price. */
function PriceAlertForm({ onAdd, disabled }: { onAdd: (alert: PriceAlert) => void; disabled: boolean }) {
  const [coin, setCoin] = useState("");
  const [direction, setDirection] = useState<PriceAlert["direction"]>("above");
  const [price, setPrice] = useState("");
  const normalized = normalizeCoin(coin);
  const value = Number(price);
  const valid = Boolean(normalized) && value > 0;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || disabled) return;
        onAdd({ id: `p${Date.now().toString(36)}`, coin: normalized!, direction, price: value });
        setCoin("");
        setPrice("");
      }}
    >
      <input aria-label="Coin" className={`${field} w-28`} placeholder="BTC" value={coin} onChange={(event) => setCoin(event.target.value)} />
      <SelectField<PriceAlert["direction"]>
        size="sm"
        label="Direction"
        value={direction}
        options={[
          { value: "above", label: "goes above" },
          { value: "below", label: "goes below" },
        ]}
        onChange={setDirection}
      />
      <input aria-label="Price" inputMode="decimal" className={`${field} w-32 tabular-nums`} placeholder="Price" value={price} onChange={(event) => setPrice(event.target.value.replace(/[^0-9.]/g, ""))} />
      <button type="submit" disabled={!valid || disabled} className={`${button} bg-app-chip text-app-ink hover:bg-app-selected`}>
        Add
      </button>
    </form>
  );
}

/**
 * Profile → Alerts: Telegram / Discord notifications for positions (opened, closed, changed, near liquidation),
 * price levels and news on watched coins. Settings live on the server (`/api/alerts`); a once-a-minute tick sends them.
 */
export function AlertsView() {
  const { id, signIn } = useProfile();
  const toast = useToast();
  const [status, setStatus] = useState<"loading" | "signin" | "error" | "ready">("loading");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<AlertSettings>(DEFAULT_ALERT_SETTINGS);
  const [coinsText, setCoinsText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "test" | "telegram" | "signin">(null);
  // The bot link once made: shown as a real link (opening a tab from code got blocked) plus the /start command to send by hand.
  const [telegramLink, setTelegramLink] = useState<{ url: string; bot: string; code: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const poll = useRef<number | null>(null);
  const [waiting, setWaiting] = useState(false);

  const apply = useCallback((data: Loaded) => {
    setLoaded(data);
    setDraft(data.settings);
    setCoinsText(data.settings.newsCoins.map(displayCoin).join(", "));
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    const response = await fetch("/api/alerts", { cache: "no-store" });
    if (response.status === 401) return setStatus("signin");
    if (!response.ok) return setStatus("error");
    apply((await response.json()) as Loaded);
    setStatus("ready");
  }, [apply]);

  useEffect(() => {
    if (!id) return;
    setStatus("loading");
    load().catch(() => setStatus("error"));
  }, [id, attempt, load]);
  useEffect(() => () => void (poll.current && window.clearInterval(poll.current)), []);

  const update = (patch: Partial<AlertSettings>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  };

  const save = async () => {
    const coins = coinsText.split(/[\s,]+/).filter(Boolean);
    const bad = coins.find((coin) => !normalizeCoin(coin));
    if (bad) return toast({ tone: "error", title: `"${bad}" isn't a coin` });
    setBusy("save");
    const response = await fetch("/api/alerts", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...draft, newsCoins: coins }),
    }).catch(() => null);
    setBusy(null);
    const body = (await response?.json().catch(() => null)) as { settings?: AlertSettings; error?: string } | null;
    if (!response?.ok || !body?.settings) return toast({ tone: "error", title: "Couldn't save alerts", message: body?.error });
    apply({ ...loaded!, settings: body.settings });
    toast({ tone: "success", title: "Alerts saved" });
  };

  const sendTest = async () => {
    setBusy("test");
    const response = await fetch("/api/alerts/test", { method: "POST" }).catch(() => null);
    setBusy(null);
    const body = (await response?.json().catch(() => null)) as { discord?: boolean; telegram?: boolean; error?: string } | null;
    if (!response?.ok) return toast({ tone: "error", title: "Test failed", message: body?.error });
    const reached = [body?.discord && "Discord", body?.telegram && "Telegram"].filter(Boolean);
    toast(reached.length ? { tone: "success", title: `Test sent to ${reached.join(" and ")}` } : { tone: "error", title: "No channel took the test", message: "Check the webhook URL or reconnect Telegram." });
  };

  const connectTelegram = async () => {
    setBusy("telegram");
    const response = await fetch("/api/alerts/telegram/link", { method: "POST" }).catch(() => null);
    setBusy(null);
    const body = (await response?.json().catch(() => null)) as { url?: string; error?: string } | null;
    const link = body?.url ? /^https:\/\/t\.me\/(\w+)\?start=([\w-]+)$/.exec(body.url) : null;
    if (!response?.ok || !body?.url || !link) {
      // Say what went wrong: a bare "try again" left no way to tell a server error from a bad bot setting.
      const message =
        body?.error ??
        (!response
          ? "No connection to the site."
          : body?.url
            ? `The bot link isn't a t.me link (${body.url.slice(0, 60)}): check TELEGRAM_BOT_USERNAME.`
            : `The server answered ${response.status}. Try again in a moment.`);
      return toast({ tone: "error", title: "Couldn't start Telegram", message });
    }
    setTelegramLink({ url: body.url, bot: link[1], code: link[2] });
    // Wait for the bot to link the chat (the user presses Start there), up to the code's lifetime.
    if (poll.current) window.clearInterval(poll.current);
    setWaiting(true);
    const started = Date.now();
    poll.current = window.setInterval(async () => {
      const latest = await fetch("/api/alerts", { cache: "no-store" }).then((res) => (res.ok ? (res.json() as Promise<Loaded>) : null)).catch(() => null);
      if (latest?.settings.telegramChatId) {
        setLoaded(latest);
        setDraft((current) => ({ ...current, telegramChatId: latest.settings.telegramChatId }));
        toast({ tone: "success", title: "Telegram connected" });
      }
      if (latest?.settings.telegramChatId || Date.now() - started > 15 * 60_000) {
        window.clearInterval(poll.current!);
        poll.current = null;
        setWaiting(false);
        setTelegramLink(null);
      }
    }, 3_000);
  };

  const disconnectTelegram = async () => {
    setBusy("telegram");
    const response = await fetch("/api/alerts/telegram/link", { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!response?.ok) return toast({ tone: "error", title: "Couldn't disconnect Telegram" });
    setDraft((current) => ({ ...current, telegramChatId: null }));
    setLoaded((current) => (current ? { ...current, settings: { ...current.settings, telegramChatId: null } } : current));
  };

  if (!id) return <p className="py-12 text-center text-[13px] text-app-muted">Connect a wallet to set up alerts.</p>;
  if (status === "loading") return <p className="py-12 text-center text-[13px] text-app-muted">Loading alerts…</p>;
  if (status === "error") return <p className="py-12 text-center text-[13px] text-app-muted">Couldn&apos;t load alerts. Try again in a moment.</p>;
  if (status === "signin") {
    return (
      <section className={`${card} flex flex-col items-start gap-3 p-5`}>
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-app-ink">
          <Bell className="size-4" aria-hidden />
          Alerts
        </h2>
        <p className="text-[13px] text-app-muted">
          Get Telegram or Discord messages when a position opens, closes or nears liquidation, a price is hit, or news lands on your coins. Sign in with your
          wallet to set them up: one signature, no fee, good for 30 days.
        </p>
        <button
          type="button"
          disabled={busy === "signin"}
          onClick={async () => {
            setBusy("signin");
            if (!(await signIn())) setAttempt((value) => value + 1);
            setBusy(null);
          }}
          className={`${button} bg-app-accent text-app-on-accent`}
        >
          {busy === "signin" ? "Sign in your wallet…" : "Sign in"}
        </button>
      </section>
    );
  }

  const webhookInvalid = Boolean(draft.discordWebhook) && !isDiscordWebhook(draft.discordWebhook ?? "");
  const saved = loaded!.settings;
  const hasChannel = Boolean(saved.discordWebhook || saved.telegramChatId);

  return (
    <div className="flex flex-col gap-4 pb-20">
      <section className={`${card} p-4 sm:p-5`}>
        <h2 className="text-[15px] font-semibold text-app-ink">Where to send</h2>
        <SettingRow title="Telegram" description={loaded!.telegram ? "Opens our bot; press Start there to link this chat." : "Not available on this site yet."}>
          {saved.telegramChatId ? (
            <span className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-app-up">Connected</span>
              <button type="button" disabled={busy === "telegram"} onClick={() => void disconnectTelegram()} className={`${button} text-app-muted hover:text-app-ink`}>
                Disconnect
              </button>
            </span>
          ) : telegramLink ? (
            <a href={telegramLink.url} target="_blank" rel="noopener noreferrer" className={`${button} bg-app-accent text-app-on-accent`}>
              <Send className="size-3.5" aria-hidden />
              Open @{telegramLink.bot}
            </a>
          ) : (
            <button type="button" disabled={!loaded!.telegram || busy === "telegram"} onClick={() => void connectTelegram()} className={`${button} bg-app-chip text-app-ink hover:bg-app-selected`}>
              <Send className="size-3.5" aria-hidden />
              {busy === "telegram" ? "Making a link…" : "Connect Telegram"}
            </button>
          )}
        </SettingRow>
        {telegramLink && !saved.telegramChatId && (
          <p className="-mt-2 pb-3 text-[12px] text-app-muted">
            {waiting ? "Waiting for Start… " : ""}Press Start in the bot. If the link doesn&apos;t open Telegram, send this to @{telegramLink.bot}:{" "}
            <code className="select-all rounded bg-app-chip px-1.5 py-0.5 font-mono text-app-ink">/start {telegramLink.code}</code> (valid 15 minutes).
          </p>
        )}
        <div className="flex flex-col gap-2 border-b border-app-line py-4">
          <p className="text-[15px] font-semibold text-app-ink">Discord</p>
          <p className="text-[13px] text-app-muted">Channel settings → Integrations → Webhooks → New webhook → Copy URL, then paste it here.</p>
          <input
            aria-label="Discord webhook URL"
            className={field}
            placeholder="https://discord.com/api/webhooks/…"
            value={draft.discordWebhook ?? ""}
            onChange={(event) => update({ discordWebhook: event.target.value.trim() || null })}
          />
          {webhookInvalid && <p className="text-[12px] text-app-down">That isn&apos;t a Discord webhook URL.</p>}
        </div>
        <div className="flex items-center justify-between gap-3 pt-4">
          <p className="text-[12px] text-app-muted">{hasChannel ? "Alerts are checked every minute." : "Add a channel to start getting alerts."}</p>
          <button type="button" disabled={!hasChannel || dirty || busy === "test"} onClick={() => void sendTest()} className={`${button} bg-app-chip text-app-ink hover:bg-app-selected`} title={dirty ? "Save first" : undefined}>
            {busy === "test" ? "Sending…" : "Send test"}
          </button>
        </div>
      </section>

      <section className={`${card} p-4 sm:p-5`}>
        <h2 className="text-[15px] font-semibold text-app-ink">What to send</h2>
        {!loaded!.evm && <p className="mt-2 text-[12px] text-app-faint">Position alerts need an EVM wallet profile (Hyperliquid, Lighter).</p>}
        <SettingRow title="Positions" description="Opened, closed, added to, reduced or flipped on Hyperliquid and Lighter (TP/SL and liquidations show as closes).">
          <Toggle label="Position alerts" checked={draft.positions} onChange={(positions) => update({ positions })} />
        </SettingRow>
        <SettingRow title="Near liquidation" description="Once, when a position gets this close to its liquidation price.">
          <SelectField
            size="sm"
            label="Liquidation distance"
            value={draft.liquidationPct === null ? "off" : String(draft.liquidationPct)}
            options={offOr(LIQUIDATION_STEPS, "%")}
            onChange={(value) => update({ liquidationPct: value === "off" ? null : Number(value) })}
          />
        </SettingRow>
        <SettingRow title="News" description="Headlines at or above this impact on your coins.">
          <SelectField
            size="sm"
            label="News impact"
            value={draft.newsMinImpact === null ? "off" : String(draft.newsMinImpact)}
            options={offOr(NEWS_IMPACT_STEPS, "+")}
            onChange={(value) => update({ newsMinImpact: value === "off" ? null : Number(value) })}
          />
        </SettingRow>
        {draft.newsMinImpact !== null && (
          <div className="flex flex-col gap-3 py-4">
            <label className="flex items-center justify-between gap-3 text-[13px] text-app-muted">
              Coins of my open positions
              <Toggle label="News on my positions' coins" checked={draft.newsHeld} onChange={(newsHeld) => update({ newsHeld })} />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] text-app-muted">
              Also these coins
              <input
                className={field}
                placeholder="BTC, ETH, SOL"
                value={coinsText}
                onChange={(event) => {
                  setCoinsText(event.target.value);
                  setDirty(true);
                }}
              />
            </label>
          </div>
        )}
      </section>

      <section className={`${card} p-4 sm:p-5`}>
        <h2 className="text-[15px] font-semibold text-app-ink">Price alerts</h2>
        <p className="mt-1 text-[13px] text-app-muted">Hyperliquid mid price; each alert fires once.</p>
        <div className="mt-3 flex flex-col gap-1.5">
          {draft.prices.map((alert) => {
            const fired = loaded!.fired.includes(alert.id) && saved.prices.some((entry) => entry.id === alert.id);
            return (
              <div key={alert.id} className="flex items-center gap-3 rounded-lg bg-app-chip/50 px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 text-app-ink">
                  <span className="font-semibold">{displayCoin(alert.coin)}</span> goes {alert.direction} <span className="tabular-nums">{formatPrice(alert.price)}</span>
                </span>
                {fired && <span className="rounded-md bg-app-up/15 px-1.5 py-0.5 text-[11px] font-semibold text-app-up">Triggered</span>}
                <button
                  type="button"
                  aria-label={`Delete ${displayCoin(alert.coin)} alert`}
                  onClick={() => update({ prices: draft.prices.filter((entry) => entry.id !== alert.id) })}
                  className="text-app-faint hover:text-app-down"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-3">
          <PriceAlertForm disabled={draft.prices.length >= MAX_PRICE_ALERTS} onAdd={(alert) => update({ prices: [...draft.prices, alert] })} />
        </div>
      </section>

      {dirty && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-2xl border border-app-hairline-strong bg-app-card px-4 py-3 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.7)]">
          <span className="text-[13px] text-app-muted">Unsaved changes</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => apply(loaded!)} className={`${button} text-app-muted hover:text-app-ink`}>
              Discard
            </button>
            <button type="button" disabled={busy === "save" || webhookInvalid} onClick={() => void save()} className={`${button} bg-app-accent text-app-on-accent`}>
              {busy === "save" ? "Saving…" : "Save alerts"}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
