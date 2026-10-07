"use client";

import { ExternalLink, Play, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { playAlertSound } from "@/lib/alerts/sounds";
import { deployment, otherDeploymentUrl, venueAvailable, type VenueKey } from "@/lib/deployment";
import { useT } from "@/lib/i18n/client";
import { alertSounds, navModeChange, panelNames, toastPositions, type AlertSound, type TerminalPanels } from "@/lib/preferences";
import { settingsHref, settingsSections, type SettingsSectionId } from "@/lib/settings-sections";
import { shortCommitSha } from "@/lib/site";
import { getTimeZoneOptions, type TimeZoneOption } from "@/lib/time-zones";
import { sizePresets } from "@/lib/trading/presets";
import { arcusConfig } from "@/lib/venues/arcus/config";
import { HL_NETWORK_OVERRIDE_KEY, defaultHlNetwork, hlConfig, type HlNetwork } from "@/lib/venues/hyperliquid/config";
import { LIGHTER_NETWORK_OVERRIDE_KEY, LIGHTER_RH_NETWORK_OVERRIDE_KEY, defaultLighterNetwork, defaultLighterRhNetwork, lighterConfig, lighterRhConfig } from "@/lib/venues/lighter/config";
import type { PerpVenueId } from "@/lib/venues/types";
import { useMarketList } from "@/components/app/use-market-list";
import type { Market } from "@/lib/markets/model";
import { defaultNewsFilters, sentiments, severities, type NewsFilters, type Sentiment } from "@/lib/news/filter";
import { describeRule, MAX_RULES, type NewsRule, type RuleAction, type RuleSentiment } from "@/lib/news/rules";
import type { Severity } from "@/lib/types";
import { openWelcomeTour } from "./alpha-notice";
import { AppearanceSettings } from "./appearance-settings";
import { MarketIcon } from "./market-icon";
import { NumberStepper, SegmentedControl, SelectField, SettingRow, Toggle } from "./form-controls";
import { usePreferences } from "./preferences-provider";
import { useSolanaWallet } from "@/components/terminal/solana-wallet-provider";
import { SearchableSelect } from "./searchable-select";
import { RangeSlider } from "./range-slider";

const DISCLAIMER = "Not financial advice. Scores are model outputs.";


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
        description="Angler chart (TradingView Lightweight Charts) marks headlines on the candles. Perps chart the venue you trade on (Hyperliquid or Lighter, Binance as a fallback or by choice in the chart header); spot charts the traded token's own DEX pool. The TradingView widget is TradingView's full chart with its own indicators and drawing tools."
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

const ruleInput =
  "h-10 rounded-xl border border-app-field-border bg-app-field px-3 text-[14px] text-app-ink outline-hidden focus:border-app-ink";

/** "When news like this arrives, do that": rules run by `news-rules-runner.tsx` while the terminal is open. */
function NewsRulesSettings() {
  const { preferences, updatePreference } = usePreferences();
  const rules = preferences.newsRules;
  const [scope, setScope] = useState<"*" | "positions" | "symbol">("*");
  const [symbol, setSymbol] = useState("BTC");
  const [minImpact, setMinImpact] = useState(80);
  const [sentiment, setSentiment] = useState<RuleSentiment>("any");
  const [action, setAction] = useState<RuleAction>("alert");
  const [sizeUsd, setSizeUsd] = useState("25");
  const [auto, setAuto] = useState(false);
  const markets = useMarketList("perp");
  const isTrade = action === "long" || action === "short";
  const ticker = symbol.trim().toUpperCase();
  const valid = (scope !== "symbol" || /^[A-Z0-9]{1,20}$/.test(ticker)) && (!isTrade || Number(sizeUsd) > 0) && rules.length < MAX_RULES;
  const save = (next: NewsRule[]) => updatePreference("newsRules", next);

  const add = () => {
    if (!valid) return;
    save([
      ...rules,
      {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        enabled: true,
        asset: scope === "symbol" ? ticker : scope,
        minImpact,
        sentiment,
        action,
        sizeUsd: isTrade ? Number(sizeUsd) : 0,
        auto: action !== "alert" && auto,
      },
    ]);
  };

  return (
    <div>
      <p className="border-b border-app-line py-4 text-[13px] leading-relaxed text-app-muted">
        Rules watch the feed while the terminal is open and act on fresh analyzed news: alert you, open a perp position on the best venue, or close a
        position. Trades ask with a one-press prompt unless you make them automatic. Bullish, bearish and adverse rules need sentiment, which comes
        with the realtime feed.
      </p>
      {rules.length > 0 && (
        <ul className="border-b border-app-line py-2">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center gap-3 py-2">
              <Toggle
                label={`Rule: ${describeRule(rule)}`}
                checked={rule.enabled}
                onChange={(checked) => save(rules.map((entry) => (entry.id === rule.id ? { ...entry, enabled: checked } : entry)))}
              />
              <span className={`min-w-0 flex-1 text-[14px] ${rule.enabled ? "text-app-ink" : "text-app-faint"}`}>{describeRule(rule)}</span>
              <button
                type="button"
                onClick={() => save(rules.filter((entry) => entry.id !== rule.id))}
                aria-label={`Delete rule: ${describeRule(rule)}`}
                className="rounded-lg p-1.5 text-app-faint hover:bg-app-selected hover:text-app-down"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-3 py-4">
        <p className="text-[15px] font-semibold text-app-ink">New rule</p>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-app-muted">
          When
          <SelectField
            label="Sentiment"
            className="w-[130px]"
            value={sentiment}
            options={[
              { value: "any", label: "any" },
              { value: "positive", label: "bullish" },
              { value: "negative", label: "bearish" },
              { value: "adverse", label: "adverse" },
            ]}
            onChange={(value) => setSentiment(value as RuleSentiment)}
          />
          news on
          <SelectField
            label="Asset"
            className="w-[150px]"
            value={scope}
            options={[
              { value: "*", label: "any asset" },
              { value: "positions", label: "my positions" },
              { value: "symbol", label: "one asset" },
            ]}
            onChange={(value) => setScope(value as typeof scope)}
          />
          {scope === "symbol" && (
            <div className="w-[170px]">
              <SearchableSelect
                compact
                menuAlign="right"
                items={markets ?? []}
                value={symbol}
                onChange={(next) => next && setSymbol(next)}
                getKey={getSymbol}
                getSearchText={getMarketSearch}
                getDisplayValue={getSymbol}
                renderSelectedIcon={(market) => <MarketIcon symbol={market.symbol} kind={market.kind} size={18} />}
                renderOption={MarketOption}
                label="Asset"
                placeholder="Pick an asset"
                searchPlaceholder="Search, e.g. BTC or NVDA"
                emptyMessage="No market matches."
              />
            </div>
          )}
          scores at least
          <ImpactStepper label="Minimum impact" value={minImpact} onChange={setMinImpact} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-app-muted">
          then
          <SelectField
            label="Action"
            className="w-[170px]"
            value={action}
            options={[
              { value: "alert", label: "alert me" },
              { value: "long", label: "open a long" },
              { value: "short", label: "open a short" },
              { value: "close", label: "close the position" },
            ]}
            onChange={(value) => setAction(value as RuleAction)}
          />
          {isTrade && (
            <>
              of $
              <input aria-label="Size in USD" inputMode="decimal" className={`${ruleInput} w-[90px]`} value={sizeUsd} onChange={(event) => setSizeUsd(event.target.value.replace(/[^0-9.]/g, ""))} />
            </>
          )}
          {action !== "alert" && (
            <label className="ml-2 flex items-center gap-2">
              <Toggle label="Run automatically" checked={auto} onChange={setAuto} />
              without asking
            </label>
          )}
        </div>
        {action !== "alert" && auto && (
          <p className="text-[12px] text-app-down">
            Automatic rules trade with real funds on mainnet as soon as matching news arrives, at most once every 5 minutes per rule. Model scores
            can be wrong.
          </p>
        )}
        {sentiment === "adverse" && scope !== "positions" && (
          <p className="text-[12px] text-app-faint">Adverse means against a position you hold, so it only fires on assets you have a position in.</p>
        )}
        <div>
          <button
            type="button"
            disabled={!valid}
            onClick={add}
            className="h-10 rounded-xl bg-app-accent px-4 text-[14px] font-semibold text-app-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Add rule
          </button>
          {rules.length >= MAX_RULES && <span className="ml-3 text-[12px] text-app-faint">Up to {MAX_RULES} rules.</span>}
        </div>
      </div>
    </div>
  );
}

function LayoutSettings() {
  const { preferences, updatePreference } = usePreferences();
  const descriptions: Record<keyof TerminalPanels, string> = {
    orderEntry: "Market and limit orders for the chart's asset on any venue that lists it.",
    orderbook: "Live order book and recent trades of the selected venue. Click a price to use it as the limit price.",
    positions: "Positions and open orders of every connected venue, with per-venue totals.",
    news: "The live Angler News feed with trade buttons on important news.",
    account: "Balances and trading keys per venue (shown once a wallet is connected).",
    watchlist: "A markets column left of the chart: every market, the ones you hold and the ones you starred.",
  };
  return (
    <>
      <p className="border-b border-app-line py-4 text-[13px] leading-relaxed text-app-muted">
        Turn panels on or off; the chart takes the free space. Also from Layout in the sidebar.
      </p>
      <SettingRow title="Navigation" description="The menu in the left rail, or in the top bar to give the terminal the full width.">
        <SegmentedControl
          label="Navigation"
          value={preferences.navMode}
          options={[
            { value: "sidebar", label: "Sidebar" },
            { value: "top", label: "Top bar" },
          ]}
          onChange={(value) => {
            const next = navModeChange(value, preferences.tapePosition);
            updatePreference("navMode", next.navMode);
            updatePreference("tapePosition", next.tapePosition);
          }}
        />
      </SettingRow>
      <SettingRow title="Price tape" description="In the top bar, in a strip at the bottom, or hidden.">
        <SegmentedControl
          label="Price tape"
          value={preferences.tapePosition}
          options={[
            { value: "top", label: "Top" },
            { value: "bottom", label: "Bottom" },
            { value: "off", label: "Off" },
          ]}
          onChange={(value) => updatePreference("tapePosition", value)}
        />
      </SettingRow>
      <SettingRow title="Page" description="Scroll: the page scrolls and panels stay roomy. Fit screen: everything squeezed into one screen.">
        <SegmentedControl
          label="Page"
          value={preferences.fitToScreen ? "fit" : "scroll"}
          options={[
            { value: "scroll", label: "Scroll" },
            { value: "fit", label: "Fit screen" },
          ]}
          onChange={(value) => updatePreference("fitToScreen", value === "fit")}
        />
      </SettingRow>
      <SettingRow title="Notifications" description="Where order results and errors pop up.">
        <SegmentedControl label="Notifications" value={preferences.toastPosition} options={toastPositions} onChange={(value) => updatePreference("toastPosition", value)} />
      </SettingRow>
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

function MarketOption(market: Market) {
  return (
    <>
      <MarketIcon symbol={market.symbol} kind={market.kind} size={20} />
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-app-ink">{market.symbol}</span>
      <span className="text-[12px] text-app-muted">{market.kind === "stock" ? "Stock" : "Crypto"}</span>
    </>
  );
}

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
              renderOption={MarketOption}
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
      <SettingRow title="English headlines" description="Show non-English news (Chinese, Korean…) translated to English. Hover a translated headline to see the original.">
        <Toggle label="English headlines" checked={preferences.newsTranslate} onChange={(checked) => updatePreference("newsTranslate", checked)} />
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
          {badge && <span className="rounded-sm bg-app-chip px-1.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em] text-app-muted">{badge}</span>}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-app-muted">{description}</p>
      </div>
      {children}
    </div>
  );
}

const venueNames: Record<VenueKey, string> = { hyperliquid: "Hyperliquid", lighter: "Lighter", lighterRh: "Lighter RH", jupiter: "Jupiter", titan: "Titan", arcus: "Arcus" };

function VenueSettings() {
  const { preferences, updatePreference } = usePreferences();
  // Solana venues need a Solana wallet: until one is connected their switches show off and can't be changed.
  const solanaConnected = Boolean(useSolanaWallet().address);
  const solanaLock = solanaConnected ? undefined : "Connect a Solana wallet to use this venue";
  const unavailable = (Object.keys(venueNames) as VenueKey[]).filter((venue) => !venueAvailable(venue)).map((venue) => venueNames[venue]);
  const [choice, setChoice] = useState<NetworkChoice>("default");
  const [lighterChoice, setLighterChoice] = useState<NetworkChoice>("default");
  const [lighterRhChoice, setLighterRhChoice] = useState<NetworkChoice>("default");
  useEffect(() => {
    setChoice(readNetworkChoice(HL_NETWORK_OVERRIDE_KEY));
    setLighterChoice(readNetworkChoice(LIGHTER_NETWORK_OVERRIDE_KEY));
    setLighterRhChoice(readNetworkChoice(LIGHTER_RH_NETWORK_OVERRIDE_KEY));
  }, []);
  // Every enabled perp venue can be the preferred one.
  const perpChoices = [
    preferences.venueHyperliquid && { value: "hyperliquid" as const, label: "Hyperliquid" },
    preferences.venueLighter && { value: "lighter" as const, label: "Lighter" },
    preferences.venueLighterRh && { value: "lighterRh" as const, label: "Lighter RH" },
  ].filter((option): option is { value: PerpVenueId; label: string } => Boolean(option));

  return (
    <>
      {unavailable.length > 0 && (
        <p className="border-b border-app-line py-4 text-[13px] leading-relaxed text-app-muted">
          Not available on this site: {unavailable.join(", ")}.
          {deployment === "mainnet" ? " They switch on once their settings are added to the deployment." : ""}
        </p>
      )}
      {deployment && (
        <SettingRow
          title={deployment === "mainnet" ? "Mainnet site" : "Testnet site"}
          description={
            deployment === "mainnet"
              ? "Every venue trades with real funds here. Practice with test funds on the testnet site."
              : "Every venue trades with test funds here, and the mainnet-only Solana venues (Jupiter, Titan) are off. Real trading lives on the mainnet site."
          }
        >
          {otherDeploymentUrl && (
            <a
              href={otherDeploymentUrl}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-app-field-border px-4 text-[14px] font-semibold text-app-ink hover:bg-app-selected"
            >
              Open {deployment === "mainnet" ? "testnet" : "mainnet"} site
              <ExternalLink className="size-4" aria-hidden />
            </a>
          )}
        </SettingRow>
      )}
      {venueAvailable("hyperliquid") && (
      <VenueRow name="Hyperliquid" badge="Perps · EVM" description="Perpetuals and HIP-3 equity perps. Orders sign with a browser trading key after a one-time setup.">
        <Toggle label="Hyperliquid" checked={preferences.venueHyperliquid} onChange={(checked) => updatePreference("venueHyperliquid", checked)} />
      </VenueRow>
      )}
      {preferences.venueHyperliquid && !deployment && (
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
      {preferences.venueLighter && !deployment && (
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
      {venueAvailable("lighterRh") && (
        <VenueRow
          name="Lighter RH"
          badge="Perps · Robinhood Chain"
          description="Lighter on Robinhood Chain: a separate Lighter exchange with USDG margin and mostly stock perps (the venue behind Robinhood Wallet's perps). Its own account (first USDG deposit on Robinhood Chain) and its own browser trading key."
        >
          <Toggle label="Lighter RH" checked={preferences.venueLighterRh} onChange={(checked) => updatePreference("venueLighterRh", checked)} />
        </VenueRow>
      )}
      {preferences.venueLighterRh && !deployment && (
        <div className="ml-4 border-l-2 border-app-line pl-4">
          <SettingRow
            title="Network"
            description={`Currently ${lighterRhConfig.network}; changing it reloads the page. The deployment default is ${defaultLighterRhNetwork}.`}
          >
            <SegmentedControl
              label="Lighter RH network"
              value={lighterRhChoice}
              options={networkOptions}
              onChange={(value) => value !== lighterRhChoice && changeNetwork(LIGHTER_RH_NETWORK_OVERRIDE_KEY, value)}
            />
          </SettingRow>
        </div>
      )}
      {perpChoices.length > 1 && (
        <SettingRow
          title="Preferred perp venue"
          description="News perp trades go here first. When it doesn't list the asset, the next enabled perp venue is used."
        >
          <SegmentedControl
            label="Preferred perp venue"
            value={perpChoices.some((option) => option.value === preferences.preferredPerpVenue) ? preferences.preferredPerpVenue : perpChoices[0].value}
            options={perpChoices}
            onChange={(value) => updatePreference("preferredPerpVenue", value)}
          />
        </SettingRow>
      )}
      {venueAvailable("jupiter") && (
        <VenueRow name="Jupiter" badge="Spot · Solana" description="Verified Solana tokens through Jupiter Swap V2. Mainnet only: every swap uses real funds and asks your wallet to sign.">
          <Toggle
            label="Jupiter"
            checked={solanaConnected && preferences.venueJupiter}
            disabled={!solanaConnected}
            title={solanaLock}
            onChange={(checked) => updatePreference("venueJupiter", checked)}
          />
        </VenueRow>
      )}
      {venueAvailable("arcus") && (
      <VenueRow
        name="Arcus"
        badge={`Stock tokens · Robinhood Chain ${arcusConfig.network}`}
        description="24/7 stock and index tokens, bought and sold with USDG. Used for stocks that no perp venue lists, and in the test order form. Gasless: your wallet signs, Arcus settles."
      >
        <Toggle label="Arcus" checked={preferences.venueArcus} onChange={(checked) => updatePreference("venueArcus", checked)} />
      </VenueRow>
      )}
{venueAvailable("titan") && (
      <VenueRow
        name="Titan"
        badge="Spot · Solana"
        description="Solana meta-aggregator. Every Solana spot trade asks Titan and Jupiter for a quote and executes the one that pays more. Active once the server has a Titan API key."
      >
        <Toggle
          label="Titan"
          checked={solanaConnected && preferences.venueTitan}
          disabled={!solanaConnected}
          title={solanaLock}
          onChange={(checked) => updatePreference("venueTitan", checked)}
        />
      </VenueRow>
      )}
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

/** Asks for permission when turned on; a blocked permission is explained instead of failing silently. */
function NewsNotificationsRow() {
  const { preferences, updatePreference } = usePreferences();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  );
  const description =
    permission === "unsupported"
      ? "This browser doesn't support notifications."
      : permission === "denied"
        ? "Notifications are blocked for this site. Allow them in your browser's site settings, then turn this on."
        : "Get a notification for high-impact news while the terminal is in a background tab. Click it to jump to the news.";
  return (
    <SettingRow title="Notifications for high-impact news" description={description}>
      <Toggle
        label="Notifications for high-impact news"
        checked={preferences.newsNotifications && permission === "granted"}
        onChange={async (checked) => {
          if (!checked) return updatePreference("newsNotifications", false);
          if (permission === "unsupported") return;
          const result = permission === "granted" ? "granted" : await Notification.requestPermission();
          setPermission(result);
          updatePreference("newsNotifications", result === "granted");
        }}
      />
    </SettingRow>
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
      <NewsNotificationsRow />
      <SettingRow title={t("settings.newsSound")} description={t("settings.newsSoundText")}>
        <SoundSelect label={t("settings.newsSound")} value={preferences.newsSound} volume={preferences.alertVolume} onChange={(sound) => updatePreference("newsSound", sound)} />
      </SettingRow>
      <SettingRow title={t("settings.volume")} description={t("settings.volumeText")}>
        <div className="flex w-[150px] shrink-0 items-center gap-3">
          <RangeSlider
            label={t("settings.volume")}
            min={0}
            max={100}
            step={5}
            value={preferences.alertVolume}
            onChange={(volume) => updatePreference("alertVolume", volume)}
            onPointerUp={() => playAlertSound("bell", preferences.alertVolume)}
            className="min-w-0 flex-1"
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
      <SettingRow title="Onboarding" description="The welcome screen, the layout picker and the alpha notice.">
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

function SectionContent({ section }: { section: SettingsSectionId }) {
  if (section === "general") return <GeneralSettings />;
  if (section === "appearance") return <AppearanceSettings />;
  if (section === "layout") return <LayoutSettings />;
  if (section === "filters") return <NewsFilterSettings />;
  if (section === "rules") return <NewsRulesSettings />;
  if (section === "trading") return <TradingSettings />;
  if (section === "venues") return <VenueSettings />;
  if (section === "notifications") return <NotificationSettings />;
  return <AboutSettings />;
}

/** The settings page: sections on the left (a scrolling strip on phones), each at its own URL. */
export function SettingsView({ section }: { section: SettingsSectionId }) {
  const t = useT();
  const activeLabel = settingsSections.find((entry) => entry.id === section)?.label;

  return (
    <div className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55">
      <header className="flex shrink-0 items-center justify-between border-b border-app-line px-5 py-3.5">
        <h1 className="text-[18px] font-semibold">{t("nav.settings")}</h1>
      </header>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <nav
          aria-label={t("settings.sections")}
          className="scrollbar-subtle flex shrink-0 gap-1 overflow-x-auto border-b border-app-line p-3 sm:w-56 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r"
        >
          {settingsSections.map((entry) => (
            <Link
              key={entry.id}
              href={settingsHref(entry.id)}
              replace
              scroll={false}
              aria-current={entry.id === section ? "page" : undefined}
              className={`shrink-0 rounded-xl px-4 py-2.5 text-left text-[15px] transition-colors ${
                entry.id === section ? "bg-app-selected font-semibold text-app-ink" : "text-app-muted hover:bg-app-selected/70 hover:text-app-ink"
              }`}
            >
              {entry.label}
            </Link>
          ))}
        </nav>
        <section className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8">
          <div className="max-w-3xl">
            <h2 className="text-[18px] font-medium text-app-ink">{activeLabel}</h2>
            <SectionContent section={section} />
          </div>
        </section>
      </div>
    </div>
  );
}
