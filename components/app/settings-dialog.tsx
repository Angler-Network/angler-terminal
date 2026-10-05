"use client";

import { ExternalLink, Play, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { playAlertSound } from "@/lib/alerts/sounds";
import { useT } from "@/lib/i18n/client";
import { alertSounds, type AlertSound } from "@/lib/preferences";
import { shortCommitSha } from "@/lib/site";
import { getTimeZoneOptions, type TimeZoneOption } from "@/lib/time-zones";
import { sizePresets } from "@/lib/trading/presets";
import { HL_NETWORK_OVERRIDE_KEY, defaultHlNetwork, hlConfig, type HlNetwork } from "@/lib/venues/hyperliquid/config";
import { AppearanceSettings } from "./appearance-settings";
import { NumberStepper, SegmentedControl, SelectField, SettingRow, Toggle } from "./form-controls";
import { usePreferences } from "./preferences-provider";
import { SearchableSelect } from "./searchable-select";

const DISCLAIMER = "Not financial advice. Scores are model outputs.";

const sections = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "trading", label: "Trading" },
  { id: "venues", label: "Venues & networks" },
  { id: "notifications", label: "Notifications" },
  { id: "about", label: "About" },
] as const;

type SectionId = (typeof sections)[number]["id"];

const getZoneId = (zone: TimeZoneOption) => zone.id;
const getZoneSearchText = (zone: TimeZoneOption) => zone.searchText;
const getZoneDisplayValue = (zone: TimeZoneOption) => `${zone.city} (${zone.offsetLabel})`;

function TimeZoneOptionRow(zone: TimeZoneOption) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-app-ink">{zone.city}</span>
        <span className="block truncate text-[12px] text-app-muted">{zone.region}</span>
      </span>
      <span className="shrink-0 rounded-md bg-app-chip px-2 py-0.5 text-[11px] font-medium tabular-nums text-app-muted">{zone.offsetLabel}</span>
    </>
  );
}

function GeneralSettings() {
  const t = useT();
  const { preferences, updatePreference } = usePreferences();
  const utcLabel = t("timeZone.utc");
  const zones = useMemo(() => getTimeZoneOptions(Intl.DateTimeFormat().resolvedOptions().timeZone, utcLabel), [utcLabel]);
  return (
    <>
      <div className="border-b border-app-line py-4">
        <p className="text-[15px] font-semibold text-app-ink">{t("settings.timeZone")}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-app-muted">{t("settings.timeZoneText")}</p>
        <div className="mt-3">
          <SearchableSelect
            items={zones}
            value={preferences.timeZone}
            onChange={(id) => updatePreference("timeZone", id)}
            getKey={getZoneId}
            getSearchText={getZoneSearchText}
            getDisplayValue={getZoneDisplayValue}
            renderOption={TimeZoneOptionRow}
            label={t("settings.timeZone")}
            placeholder={t("settings.timeZonePlaceholder")}
            searchPlaceholder={t("settings.timeZoneSearch")}
            emptyMessage={t("settings.timeZoneEmpty")}
          />
        </div>
      </div>
      <SettingRow title={t("settings.framed")} description={t("settings.framedText")}>
        <Toggle label={t("settings.framed")} checked={preferences.framedLayout} onChange={(checked) => updatePreference("framedLayout", checked)} />
      </SettingRow>
    </>
  );
}

function ImpactStepper({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (next: string) => {
    const number = Math.min(100, Math.max(0, Math.round(Number(next))));
    if (Number.isFinite(number)) onChange(number);
    else setDraft(String(value));
  };
  return <NumberStepper label={label} value={draft} min={0} max={100} step={5} className="w-[120px]" onChange={setDraft} onCommit={commit} />;
}

function TradingSettings() {
  const { preferences, updatePreference } = usePreferences();
  const sizeOptions = (presets: number[]) => [
    { value: "", label: `$${presets[0]} (first preset)` },
    ...presets.slice(1).map((preset) => ({ value: String(preset), label: `$${preset}` })),
  ];
  return (
    <>
      <SettingRow title="One-click trading" description="A single press on a news size button places the order right away, without the confirm press. Off by default.">
        <Toggle label="One-click trading" checked={preferences.oneClickTrading} onChange={(checked) => updatePreference("oneClickTrading", checked)} />
      </SettingRow>
      <SettingRow title="Trade buttons from impact" description="News below this impact score shows no size buttons.">
        <ImpactStepper label="Trade buttons from impact" value={preferences.tradeMinImpact} onChange={(value) => updatePreference("tradeMinImpact", value)} />
      </SettingRow>
      <SettingRow title="Leverage for perp trades" description="Applied to Hyperliquid orders placed from news (capped by each market's maximum).">
        <SelectField
          label="Leverage for perp trades"
          value={String(preferences.newsLeverage)}
          options={[...new Set([1, 2, 3, 5, 10, 20, preferences.newsLeverage])].sort((a, b) => a - b).map((value) => ({ value: String(value), label: `${value}x` }))}
          onChange={(value) => updatePreference("newsLeverage", Number(value))}
        />
      </SettingRow>
      <SettingRow title="Default perp size" description="Size the L / S keyboard shortcuts start with on perps.">
        <SelectField
          label="Default perp size"
          value={preferences.defaultPerpUsd ? String(preferences.defaultPerpUsd) : ""}
          options={sizeOptions(sizePresets.perp)}
          onChange={(value) => updatePreference("defaultPerpUsd", value ? Number(value) : null)}
        />
      </SettingRow>
      <SettingRow title="Default spot size" description="Size the L / S keyboard shortcuts start with on spot.">
        <SelectField
          label="Default spot size"
          value={preferences.defaultSpotUsd ? String(preferences.defaultSpotUsd) : ""}
          options={sizeOptions(sizePresets.spot)}
          onChange={(value) => updatePreference("defaultSpotUsd", value ? Number(value) : null)}
        />
      </SettingRow>
      <p className="py-4 text-[12px] text-app-faint">{DISCLAIMER}</p>
    </>
  );
}

function readNetworkChoice(): HlNetwork | "default" {
  try {
    const value = window.localStorage.getItem(HL_NETWORK_OVERRIDE_KEY);
    return value === "mainnet" || value === "testnet" ? value : "default";
  } catch {
    return "default";
  }
}

function VenueRow({ name, description, badge, children }: { name: string; description: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-app-line py-4">
      <div className="min-w-0 flex-1 basis-[180px]">
        <p className="flex items-center gap-2 text-[15px] font-semibold text-app-ink">
          {name}
          {badge && <span className="rounded bg-app-chip px-1.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em] text-app-muted">{badge}</span>}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-app-muted">{description}</p>
      </div>
      {children}
    </div>
  );
}

function VenueSettings() {
  const { preferences, updatePreference } = usePreferences();
  const [choice, setChoice] = useState<HlNetwork | "default">("default");
  useEffect(() => setChoice(readNetworkChoice()), []);

  const changeNetwork = (next: HlNetwork | "default") => {
    try {
      if (next === "default") window.localStorage.removeItem(HL_NETWORK_OVERRIDE_KEY);
      else window.localStorage.setItem(HL_NETWORK_OVERRIDE_KEY, next);
    } catch {}
    // Clients, markets and the trading key are per network, so reload to start clean on the new one.
    window.location.reload();
  };

  return (
    <>
      <VenueRow name="Hyperliquid" badge="Perps · EVM" description="Perpetuals and HIP-3 equity perps. Orders sign with a browser trading key after a one-time setup.">
        <Toggle label="Hyperliquid" checked={preferences.venueHyperliquid} onChange={(checked) => updatePreference("venueHyperliquid", checked)} />
      </VenueRow>
      {preferences.venueHyperliquid && (
        <div className="ml-4 border-l-2 border-app-line pl-4">
          <SettingRow
            title="Network"
            description={`Testnet uses mock USDC from the faucet. Currently ${hlConfig.network}; changing it reloads the page. The deployment default is ${defaultHlNetwork}.`}
          >
            <SegmentedControl
              label="Hyperliquid network"
              value={choice}
              options={[
                { value: "default", label: "Default" },
                { value: "testnet", label: "Testnet" },
                { value: "mainnet", label: "Mainnet" },
              ]}
              onChange={(value) => value !== choice && changeNetwork(value)}
            />
          </SettingRow>
        </div>
      )}
      <VenueRow name="Jupiter" badge="Spot · Solana" description="Verified Solana tokens through Jupiter Swap V2. Mainnet only: every swap uses real funds and asks your wallet to sign.">
        <Toggle label="Jupiter" checked={preferences.venueJupiter} onChange={(checked) => updatePreference("venueJupiter", checked)} />
      </VenueRow>
      {[
        { name: "Lighter", badge: "Perps", description: "Zero-fee perps on Lighter's zk-rollup." },
        { name: "Titan", badge: "Spot · Solana", description: "Solana meta-aggregator; quotes will be compared with Jupiter for the best price." },
        { name: "Arcus", badge: "Stock tokens · Robinhood Chain", description: "24/7 stock tokens and indices." },
      ].map((venue) => (
        <VenueRow key={venue.name} name={venue.name} badge={venue.badge} description={venue.description}>
          <span className="rounded-lg border border-app-hairline px-2.5 py-1 text-[12px] font-semibold text-app-muted">Coming soon</span>
        </VenueRow>
      ))}
    </>
  );
}

function SoundSelect({ label, value, volume, onChange }: { label: string; value: AlertSound; volume: number; onChange: (sound: AlertSound) => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => playAlertSound(value, volume)}
        disabled={value === "none"}
        aria-label={t("settings.playSound")}
        className="inline-flex size-10 items-center justify-center rounded-xl border border-app-field-border bg-app-field text-app-ink transition-colors hover:bg-app-field-hover disabled:opacity-50"
      >
        <Play className="size-4" aria-hidden />
      </button>
      <SelectField
        label={label}
        value={value}
        options={alertSounds.map((sound) => ({ value: sound, label: t(`sound.${sound}`) }))}
        onChange={(next) => {
          const sound = alertSounds.find((candidate) => candidate === next) ?? "none";
          onChange(sound);
          playAlertSound(sound, volume);
        }}
      />
    </div>
  );
}

function NotificationSettings() {
  const t = useT();
  const { preferences, updatePreference } = usePreferences();
  return (
    <>
      <SettingRow title="High-impact highlight" description="Arriving news at or above this impact score is briefly highlighted.">
        <ImpactStepper label="High-impact threshold" value={preferences.highImpactThreshold} onChange={(value) => updatePreference("highImpactThreshold", value)} />
      </SettingRow>
      <SettingRow title="Sound on high-impact news" description="Play a bell when a high-impact item arrives. Off by default.">
        <Toggle label="Sound on high-impact news" checked={preferences.highImpactSound} onChange={(checked) => updatePreference("highImpactSound", checked)} />
      </SettingRow>
      <SettingRow title={t("settings.newsSound")} description={t("settings.newsSoundText")}>
        <SoundSelect label={t("settings.newsSound")} value={preferences.newsSound} volume={preferences.alertVolume} onChange={(sound) => updatePreference("newsSound", sound)} />
      </SettingRow>
      <SettingRow title={t("settings.volume")} description={t("settings.volumeText")}>
        <div className="flex w-[150px] shrink-0 items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={preferences.alertVolume}
            aria-label={t("settings.volume")}
            onChange={(event) => updatePreference("alertVolume", Number(event.target.value))}
            onPointerUp={() => playAlertSound("bell", preferences.alertVolume)}
            className="min-w-0 flex-1 accent-app-accent"
          />
          <span className="w-8 text-right text-[13px] tabular-nums text-app-muted">{preferences.alertVolume}</span>
        </div>
      </SettingRow>
    </>
  );
}

function AboutSettings() {
  return (
    <>
      <SettingRow title="Version" description="The terminal checks for new deployments and asks you to refresh.">
        <span className="font-mono text-[13px] text-app-muted">{shortCommitSha || "dev"}</span>
      </SettingRow>
      <SettingRow title="Angler News" description="The news feed behind the terminal.">
        <a
          href="https://news.angler.network"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-app-field-border bg-app-field px-4 text-[14px] text-app-ink hover:bg-app-field-hover"
        >
          news.angler.network <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </SettingRow>
      <p className="py-4 text-[12px] text-app-faint">{DISCLAIMER}</p>
    </>
  );
}

function SectionContent({ section }: { section: SectionId }) {
  if (section === "general") return <GeneralSettings />;
  if (section === "appearance") return <AppearanceSettings />;
  if (section === "trading") return <TradingSettings />;
  if (section === "venues") return <VenueSettings />;
  if (section === "notifications") return <NotificationSettings />;
  return <AboutSettings />;
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [activeSection, setActiveSection] = useState<SectionId>("general");
  const activeLabel = sections.find((section) => section.id === activeSection)?.label;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-app-line px-6 py-4">
        <h2 id="settings-title" className="text-[18px] font-semibold">
          {t("nav.settings")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("settings.close")}
          className="inline-flex size-9 items-center justify-center rounded-xl text-app-muted transition-colors hover:bg-app-selected/70 hover:text-app-ink"
        >
          <X className="size-[18px]" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <nav
          aria-label={t("settings.sections")}
          className="scrollbar-subtle flex shrink-0 gap-1 overflow-x-auto border-b border-app-line p-3 sm:w-52 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r"
        >
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              aria-current={section.id === activeSection ? "page" : undefined}
              onClick={() => setActiveSection(section.id)}
              className={`shrink-0 rounded-xl px-4 py-2.5 text-left text-[15px] transition-colors ${
                section.id === activeSection ? "bg-app-selected font-semibold text-app-ink" : "text-app-muted hover:bg-app-selected/70 hover:text-app-ink"
              }`}
            >
              {section.label}
            </button>
          ))}
        </nav>
        <section className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <h3 className="text-[18px] font-medium text-app-ink">{activeLabel}</h3>
          <SectionContent section={activeSection} />
        </section>
      </div>
    </div>
  );
}

/** Same dialog shell as angler-news, with the terminal's sections. */
export function SettingsDialog() {
  const { isSettingsOpen, closeSettings } = usePreferences();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isSettingsOpen && !dialog.open) dialog.showModal();
    if (!isSettingsOpen && dialog.open) dialog.close();
  }, [isSettingsOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="settings-title"
      onClose={closeSettings}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeSettings();
      }}
      className="surface-menu m-auto h-[min(600px,calc(100dvh-2rem))] w-[min(880px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-3xl border border-app-card/70 bg-app-dialog p-0 font-sans text-app-ink shadow-[0_30px_80px_-20px_rgba(3,12,21,0.6)] backdrop:bg-[#030c15]/55 backdrop:backdrop-blur-[2px] max-sm:h-[calc(100dvh-2rem)]"
    >
      {isSettingsOpen && <SettingsPanel onClose={closeSettings} />}
    </dialog>
  );
}
