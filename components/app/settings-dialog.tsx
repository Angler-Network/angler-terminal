"use client";

import { ExternalLink, Play, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { playAlertSound } from "@/lib/alerts/sounds";
import { useT } from "@/lib/i18n/client";
import { alertSounds, panelNames, type AlertSound, type TerminalPanels } from "@/lib/preferences";
import { shortCommitSha } from "@/lib/site";
import { getTimeZoneOptions, type TimeZoneOption } from "@/lib/time-zones";
import { sizePresets } from "@/lib/trading/presets";
import { arcusConfig } from "@/lib/venues/arcus/config";
import { HL_NETWORK_OVERRIDE_KEY, defaultHlNetwork, hlConfig, type HlNetwork } from "@/lib/venues/hyperliquid/config";
import { LIGHTER_NETWORK_OVERRIDE_KEY, defaultLighterNetwork, lighterConfig } from "@/lib/venues/lighter/config";
import { useMarketList } from "@/components/app/use-market-list";
import type { Market } from "@/lib/markets/model";
import { defaultNewsFilters, sentiments, severities, type NewsFilters, type Sentiment } from "@/lib/news/filter";
import type { Severity } from "@/lib/types";
import { openWelcomeTour } from "./alpha-notice";
import { AppearanceSettings } from "./appearance-settings";
import { MarketIcon } from "./market-icon";
import { NumberStepper, SegmentedControl, SelectField, SettingRow, Toggle } from "./form-controls";
import { usePreferences } from "./preferences-provider";
import { SearchableSelect } from "./searchable-select";

const DISCLAIMER = "Not financial advice. Scores are model outputs.";

const sections = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "layout", label: "Layout" },
  { id: "filters", label: "News filters" },
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
      <SettingRow
        title="Chart"
        description="Angler chart (TradingView Lightweight Charts) marks headlines on the candles and uses Binance + Hyperliquid prices. The TradingView widget is TradingView's full chart with its own indicators and drawing tools."
      >
        <SelectField
          label="Chart"
          value={preferences.chart}
          options={[
            { value: "angler", label: "Angler (Lightweight)" },
            { value: "tradingview", label: "TradingView widget" },
          ]}
          onChange={(value) => updatePreference("chart", value === "tradingview" ? "tradingview" : "angler")}
        />
      </SettingRow>
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

function LayoutSettings() {
  const { preferences, updatePreference } = usePreferences();
  const descriptions: Record<keyof TerminalPanels, string> = {
    orderEntry: "Market and limit orders for the chart's asset on any venue that lists it.",
    orderbook: "Live order book and recent trades of the selected venue. Click a price to use it as the limit price.",
    positions: "Positions and open orders of every connected venue, with per-venue totals.",
    news: "The live Angler News feed with trade buttons on important news.",
    account: "Balances and trading keys per venue (shown once a wallet is connected).",
  };
  return (
    <>
      <p className="border-b border-app-line py-4 text-[13px] leading-relaxed text-app-muted">
        Turn panels on or off; the chart takes the free space. Also from the layout button in the top bar.
      </p>
      {(Object.keys(panelNames) as Array<keyof TerminalPanels>).map((key) => (
        <SettingRow key={key} title={panelNames[key]} description={descriptions[key]}>
          <Toggle
            label={panelNames[key]}
            checked={preferences.panels[key]}
            onChange={(checked) => updatePreference("panels", { ...preferences.panels, [key]: checked })}
          />
        </SettingRow>
      ))}
    </>
  );
}

function TradingSettings() {
  const { preferences, updatePreference } = usePreferences();
  const sizeOptions = (presets: number[]) => [
    { value: "", label: `$${presets[0]} (first preset)` },
    ...presets.slice(1).map((preset) => ({ value: String(preset), label: `$${preset}` })),
  ];
  return (
    <>
      <SettingRow title="One-click trading" description="A single press on a news size button or the order panel's button places the order right away, without the confirm press. Off by default.">
        <Toggle label="One-click trading" checked={preferences.oneClickTrading} onChange={(checked) => updatePreference("oneClickTrading", checked)} />
      </SettingRow>
      <SettingRow title="Trade buttons from impact" description="News below this impact score shows no size buttons.">
        <ImpactStepper label="Trade buttons from impact" value={preferences.tradeMinImpact} onChange={(value) => updatePreference("tradeMinImpact", value)} />
      </SettingRow>
      <SettingRow title="Leverage for perp trades" description="Applied to perp orders placed from news on Hyperliquid and Lighter (capped by each market's maximum).">
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

const sentimentLabels: Record<Sentiment, string> = { bullish: "Bullish", neutral: "Neutral", bearish: "Bearish" };
const severityLabels: Record<Severity, string> = { breaking: "Breaking", important: "Important", notable: "Notable" };

function chipClass(selected: boolean) {
  return `inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-[13px] transition-colors ${
    selected ? "border-app-ink bg-app-field font-semibold text-app-ink" : "border-app-field-border bg-app-field/40 text-app-muted hover:text-app-ink"
  }`;
}

function toggleIn<T>(list: T[], value: T) {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

const getSymbol = (market: Market) => market.symbol;
const getMarketSearch = (market: Market) => `${market.symbol} ${market.kind}`;

function NewsFilterSettings() {
  const { preferences, updatePreference } = usePreferences();
  const filters = preferences.newsFilters;
  const markets = useMarketList("perp");
  const update = (patch: Partial<NewsFilters>) => updatePreference("newsFilters", { ...filters, ...patch });
  const available = (markets ?? []).filter((market) => !filters.assets.includes(market.symbol));

  return (
    <>
      <div className="border-b border-app-line py-4">
        <p className="text-[15px] font-semibold text-app-ink">Assets</p>
        <p className="mt-1 text-[13px] leading-relaxed text-app-muted">Only show news that mentions these assets. Leave empty for every asset.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {filters.assets.map((symbol) => (
            <button
              key={symbol}
              type="button"
              onClick={() => update({ assets: filters.assets.filter((entry) => entry !== symbol) })}
              title={`Remove ${symbol}`}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-app-ink bg-app-field pl-2 pr-2.5 text-[13px] font-semibold text-app-ink"
            >
              <MarketIcon symbol={symbol} size={18} />
              {symbol}
              <X className="size-3.5 text-app-muted" aria-hidden />
            </button>
          ))}
          <div className="w-[200px]">
            <SearchableSelect
              compact
              items={available}
              value=""
              onChange={(symbol) => symbol && update({ assets: [...filters.assets, symbol] })}
              getKey={getSymbol}
              getSearchText={getMarketSearch}
              getDisplayValue={() => ""}
              renderOption={(market) => (
                <>
                  <MarketIcon symbol={market.symbol} kind={market.kind} size={20} />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-app-ink">{market.symbol}</span>
                  <span className="text-[12px] text-app-muted">{market.kind === "stock" ? "Stock" : "Crypto"}</span>
                </>
              )}
              label="Add asset"
              placeholder="Add asset…"
              searchPlaceholder="Search, e.g. BTC or NVDA"
              emptyMessage="No market matches."
            />
          </div>
        </div>
      </div>
      <SettingRow title="Sentiment" description="Show news with these sentiments (model output).">
        <div role="group" aria-label="Sentiment" className="flex flex-wrap gap-2">
          {sentiments.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filters.sentiments.includes(value)}
              onClick={() => update({ sentiments: toggleIn(filters.sentiments, value) })}
              className={chipClass(filters.sentiments.includes(value))}
            >
              {sentimentLabels[value]}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow title="Importance" description="Show news at these severity levels.">
        <div role="group" aria-label="Importance" className="flex flex-wrap gap-2">
          {severities.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filters.severities.includes(value)}
              onClick={() => update({ severities: toggleIn(filters.severities, value) })}
              className={chipClass(filters.severities.includes(value))}
            >
              {severityLabels[value]}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow title="Minimum impact" description="Hide news below this impact score. Also set from the All / 40+ / 60+ / 80+ buttons in the feed.">
        <ImpactStepper label="Minimum impact" value={filters.minImpact} onChange={(value) => update({ minImpact: value })} />
      </SettingRow>
      <SettingRow title="Show raw headlines" description="Headlines that arrived but aren't analyzed yet (no assets, sentiment or impact). Hidden while an asset filter is on.">
        <Toggle label="Show raw headlines" checked={filters.showRaw} onChange={(checked) => update({ showRaw: checked })} />
      </SettingRow>
      <div className="py-4">
        <button
          type="button"
          onClick={() => updatePreference("newsFilters", defaultNewsFilters)}
          className="text-[13px] font-semibold text-app-muted hover:text-app-ink"
        >
          Reset filters
        </button>
      </div>
    </>
  );
}

type NetworkChoice = HlNetwork | "default";

function readNetworkChoice(key: string): NetworkChoice {
  try {
    const value = window.localStorage.getItem(key);
    return value === "mainnet" || value === "testnet" ? value : "default";
  } catch {
    return "default";
  }
}

function changeNetwork(key: string, next: NetworkChoice) {
  try {
    if (next === "default") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, next);
  } catch {}
  // Clients, markets and trading keys are per network, so reload to start clean on the new one.
  window.location.reload();
}

const networkOptions: { value: NetworkChoice; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "testnet", label: "Testnet" },
  { value: "mainnet", label: "Mainnet" },
];

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
  const [choice, setChoice] = useState<NetworkChoice>("default");
  const [lighterChoice, setLighterChoice] = useState<NetworkChoice>("default");
  useEffect(() => {
    setChoice(readNetworkChoice(HL_NETWORK_OVERRIDE_KEY));
    setLighterChoice(readNetworkChoice(LIGHTER_NETWORK_OVERRIDE_KEY));
  }, []);

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
              options={networkOptions}
              onChange={(value) => value !== choice && changeNetwork(HL_NETWORK_OVERRIDE_KEY, value)}
            />
          </SettingRow>
        </div>
      )}
      <VenueRow
        name="Lighter"
        badge="Perps · EVM"
        description="Perpetuals on Lighter's zk-rollup. Needs a Lighter account (first deposit), then a browser trading key registered with one wallet signature."
      >
        <Toggle label="Lighter" checked={preferences.venueLighter} onChange={(checked) => updatePreference("venueLighter", checked)} />
      </VenueRow>
      {preferences.venueLighter && (
        <div className="ml-4 border-l-2 border-app-line pl-4">
          <SettingRow
            title="Network"
            description={`Testnet trades with test funds. Currently ${lighterConfig.network}; changing it reloads the page. The deployment default is ${defaultLighterNetwork}.`}
          >
            <SegmentedControl
              label="Lighter network"
              value={lighterChoice}
              options={networkOptions}
              onChange={(value) => value !== lighterChoice && changeNetwork(LIGHTER_NETWORK_OVERRIDE_KEY, value)}
            />
          </SettingRow>
        </div>
      )}
      {preferences.venueHyperliquid && preferences.venueLighter && (
        <SettingRow
          title="Preferred perp venue"
          description="News perp trades go here first. When it doesn't list the asset, the other perp venue is used."
        >
          <SegmentedControl
            label="Preferred perp venue"
            value={preferences.preferredPerpVenue}
            options={[
              { value: "hyperliquid", label: "Hyperliquid" },
              { value: "lighter", label: "Lighter" },
            ]}
            onChange={(value) => updatePreference("preferredPerpVenue", value)}
          />
        </SettingRow>
      )}
      <VenueRow name="Jupiter" badge="Spot · Solana" description="Verified Solana tokens through Jupiter Swap V2. Mainnet only: every swap uses real funds and asks your wallet to sign.">
        <Toggle label="Jupiter" checked={preferences.venueJupiter} onChange={(checked) => updatePreference("venueJupiter", checked)} />
      </VenueRow>
      <VenueRow
        name="Arcus"
        badge={`Stock tokens · Robinhood Chain ${arcusConfig.network}`}
        description="24/7 stock and index tokens, bought and sold with USDG. Used for stocks that no perp venue lists, and in the test order form. Gasless: your wallet signs, Arcus settles."
      >
        <Toggle label="Arcus" checked={preferences.venueArcus} onChange={(checked) => updatePreference("venueArcus", checked)} />
      </VenueRow>
      <VenueRow
        name="Titan"
        badge="Spot · Solana"
        description="Solana meta-aggregator. Every Solana spot trade asks Titan and Jupiter for a quote and executes the one that pays more. Active once the server has a Titan API key."
      >
        <Toggle label="Titan" checked={preferences.venueTitan} onChange={(checked) => updatePreference("venueTitan", checked)} />
      </VenueRow>
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
  const { closeSettings } = usePreferences();
  return (
    <>
      <SettingRow title="Version" description="The terminal checks for new deployments and asks you to refresh.">
        <span className="font-mono text-[13px] text-app-muted">{shortCommitSha || "dev"}</span>
      </SettingRow>
      <SettingRow title="Welcome tour" description="What the terminal does, how it differs, and the alpha notice.">
        <button
          type="button"
          onClick={() => {
            closeSettings();
            openWelcomeTour();
          }}
          className="inline-flex h-10 items-center rounded-xl border border-app-field-border bg-app-field px-4 text-[14px] text-app-ink hover:bg-app-field-hover"
        >
          Show again
        </button>
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
  if (section === "layout") return <LayoutSettings />;
  if (section === "filters") return <NewsFilterSettings />;
  if (section === "trading") return <TradingSettings />;
  if (section === "venues") return <VenueSettings />;
  if (section === "notifications") return <NotificationSettings />;
  return <AboutSettings />;
}

function SettingsPanel({ onClose, initialSection }: { onClose: () => void; initialSection: string | null }) {
  const t = useT();
  const [activeSection, setActiveSection] = useState<SectionId>(
    sections.find((section) => section.id === initialSection)?.id ?? "general",
  );
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
  const { isSettingsOpen, settingsSection, closeSettings } = usePreferences();
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
      {isSettingsOpen && <SettingsPanel onClose={closeSettings} initialSection={settingsSection} />}
    </dialog>
  );
}
