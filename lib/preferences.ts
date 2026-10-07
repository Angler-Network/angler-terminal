import {
  applyAppearance,
  CUSTOM_CSS_ELEMENT_ID,
  defaultAppearance,
  readAppearance,
  type Appearance,
} from "./appearance";
import type { PerpVenueId } from "./venues/types";
import {
  CHART_COOKIE,
  DEFAULT_TAPE_MARKET,
  DEFAULT_TAPE_SOURCE,
  isMarketSource,
  isMarketType,
  readTapeSymbols,
  serializeChartCookie,
  serializeTapeCookie,
  TAPE_COOKIE,
  tapeMotions,
  tapeSpeeds,
  type MarketSource,
  type MarketType,
  type TapeMotion,
  type TapeSpeed,
} from "./markets/model";
import { DEFAULT_FAVORITE_INTERVALS, isChartInterval, type ChartInterval } from "./chart/candles";
import { defaultNewsFilters, sentiments, severities, type NewsFilters } from "./news/filter";
import { readNewsRules, type NewsRule } from "./news/rules";
import { readWatchlist, type WatchlistEntry } from "./watchlist";
import { venueAvailable } from "./deployment";
import { defaultPanelSizes, readPanelSizes, type PanelSizes } from "./layout/panel-sizes";
import { defaultArrangement, readArrangement, type Arrangement } from "./layout/arrangement";
import { readSlippageBps } from "./trading/slippage";

export type ChartProvider = "tradingview" | "angler";

export type ChartDataSource = "binance" | "hyperliquid";

export type ChartMarket = "spot" | "perp";

export type ToastPosition = "top" | "top-right" | "bottom-right";

export const toastPositions: { value: ToastPosition; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-right", label: "Bottom right" },
];

/** Where the Angler chart's candles come from: "auto" follows the venue picked in the order panel. */
export type ChartSource = "auto" | "hyperliquid" | "lighter" | "binance";

export const chartDataSources: { value: ChartDataSource; label: string }[] = [
  { value: "binance", label: "Binance" },
  { value: "hyperliquid", label: "Hyperliquid" },
];

export type AlertSound = "chime" | "ping" | "bell" | "pulse" | "rise" | "fall" | "none";

export const alertSounds: AlertSound[] = ["chime", "ping", "bell", "pulse", "rise", "fall", "none"];

export type NavMode = "sidebar" | "top";
export type TapePosition = "top" | "bottom" | "off";

/** Moving navigation to the top bar crowds it, so the tape drops to the footer unless the user already moved it. */
export function navModeChange(next: NavMode, tapePosition: TapePosition): { navMode: NavMode; tapePosition: TapePosition } {
  return { navMode: next, tapePosition: next === "top" && tapePosition === "top" ? "bottom" : tapePosition };
}

/** One-tap layouts offered in onboarding and the layout menu; the chart is always shown. */
export const layoutPresets: Array<{ id: string; name: string; description: string; panels: TerminalPanels }> = [
  {
    id: "news",
    name: "News trader",
    description: "Live news with trade buttons, the chart and your positions.",
    panels: { news: true, orderEntry: true, positions: true, orderbook: false, account: true, watchlist: false },
  },
  {
    id: "pro",
    name: "Pro trader",
    description: "Everything: watchlist, order book, order entry, positions and news.",
    panels: { news: true, orderEntry: true, positions: true, orderbook: true, account: true, watchlist: true },
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Just the chart, an order form and your positions.",
    panels: { news: false, orderEntry: true, positions: true, orderbook: false, account: true, watchlist: false },
  },
];

export interface TerminalPanels {
  orderbook: boolean;
  orderEntry: boolean;
  positions: boolean;
  news: boolean;
  account: boolean;
  /** Markets list left of the chart (all, yours, starred). Off by default. */
  watchlist: boolean;
}

export const panelNames: Record<keyof TerminalPanels, string> = {
  orderEntry: "Order entry",
  orderbook: "Order book & trades",
  positions: "Positions & orders",
  news: "News feed",
  account: "Account & balances",
  watchlist: "Watchlist",
};

export const defaultPanels: TerminalPanels = { orderbook: true, orderEntry: true, positions: true, news: true, account: true, watchlist: false };

function readPanels(value: unknown): TerminalPanels {
  const stored = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    (Object.keys(defaultPanels) as Array<keyof TerminalPanels>).map((key) => [key, typeof stored[key] === "boolean" ? stored[key] : defaultPanels[key]]),
  ) as unknown as TerminalPanels;
}

export interface Preferences extends Appearance {
  chart: ChartProvider;
  chartPrimarySource: ChartDataSource;
  chartFallbackSource: ChartDataSource | "none";
  chartMarket: ChartMarket;
  chartSource: ChartSource;
  showChart: boolean;
  chartSymbol: string;
  chartInterval: ChartInterval;
  /** Starred intervals shown as quick buttons above the chart. */
  chartFavoriteIntervals: ChartInterval[];
  timeZone: string;
  showScrollbars: boolean;
  framedLayout: boolean;
  containerHeaders: boolean;
  showSidebar: boolean;
  /** Navigation in the left rail or in the top bar. */
  navMode: NavMode;
  /** Where the price tape sits, or off. */
  tapePosition: TapePosition;
  /** Desktop: squeeze the terminal into one screen (true) or let the page scroll with roomier panels (false). */
  fitToScreen: boolean;
  /** Where toasts (order results, errors) appear: top center by default so they're seen. */
  toastPosition: ToastPosition;
  showTopBar: boolean;
  sidebarHiding: boolean;
  topBarHiding: boolean;
  tapeSymbols: string[] | null;
  tapeMarket: MarketType;
  tapeSource: MarketSource;
  tapeMotion: TapeMotion;
  tapeSpeed: TapeSpeed;
  dragContainers: boolean;
  showAlertBell: boolean;
  alertToasts: boolean;
  alertSound: AlertSound;
  alertVolume: number;
  newsSound: AlertSound;
  newsSoundMinImpact: number;
  newsSoundBySentiment: boolean;
  newsSoundPositive: AlertSound;
  newsSoundNegative: AlertSound;
  newsSoundSentimentThreshold: number;
  // Trading from news (terminal)
  /** One click on a news trade button places the order at the default size. Off by default. */
  oneClickTrading: boolean;
  /** Market perp orders go to the venue with the best estimated fill after fees. */
  autoRoute: boolean;
  /** Which terminal panels are shown; the chart is always on. */
  panels: TerminalPanels;
  /** Impact score (0-100) at which an arriving news item is highlighted. */
  highImpactThreshold: number;
  highImpactSound: boolean;
  /** Browser notifications for high-impact news while the tab is in the background. */
  newsNotifications: boolean;
  /** Show the API's English translation of non-English headlines (the original stays in the tooltip). */
  newsTranslate: boolean;
  /** "When news like this arrives, do that" rules (lib/news/rules.ts), run while the terminal is open. */
  newsRules: NewsRule[];
  /** Favorite markets (★ in the asset search, the Watchlist panel), newest first. */
  watchlist: WatchlistEntry[];
  /** Default USD size for news trades; null uses the venue's first preset. */
  defaultPerpUsd: number | null;
  defaultSpotUsd: number | null;
  /** News trade buttons appear for items at or above this impact score. */
  tradeMinImpact: number;
  /** Leverage for perp trades placed from news. */
  newsLeverage: number;
  /** Height of the positions panel under the chart, dragged by the user; null sizes it to its content. */
  positionsHeight: number | null;
  /** Swap slippage in bps; null is Auto (Jupiter's real-time estimate). `lib/trading/slippage.ts`. */
  swapSlippageBps: number | null;
  /** Column widths and the order book height, dragged by the user; null keeps the automatic size. */
  panelSizes: PanelSizes;
  /** Column order and which of the order book / news sits under the order panel (dragged by the user). */
  arrangement: Arrangement;
  /** With positions or orders on more than one venue: grouped under a header per venue, or one list. */
  positionsLayout: "grouped" | "list";
  appearanceVersion: number;
  /** Venues the terminal routes trades to; a disabled venue never shows trade buttons. */
  venueHyperliquid: boolean;
  venueLighter: boolean;
  /** Lighter on Robinhood Chain, a separate Lighter exchange (USDG margin, mostly stock perps). */
  venueLighterRh: boolean;
  venueJupiter: boolean;
  venueArcus: boolean;
  /** Quote Robinhood Chain stock tokens on Uniswap too and swap on the better of Uniswap and Arcus (mainnet). */
  venueUniswap: boolean;
  /** Compare Titan quotes with Jupiter's on Solana spot trades (needs TITAN_API_KEY on the server). */
  venueTitan: boolean;
  /** Perp venue news trades go to; the other enabled perp venue is the fallback when this one doesn't list the asset. */
  preferredPerpVenue: PerpVenueId;
  /** Which headlines the feed shows (assets, sentiment, severity, minimum impact, raw headlines). */
  newsFilters: NewsFilters;
}

export const PREFERENCES_STORAGE_KEY = "angler-terminal:preferences:v1";

/**
 * Bumped when the default look changes. Stored theme/surface from an older version are dropped once so everyone
 * moves to the new default (OLED + Liquid); every other preference is kept.
 */
export const APPEARANCE_VERSION = 2;

export const defaultPreferences: Preferences = {
  chart: "angler",
  chartPrimarySource: "binance",
  chartFallbackSource: "hyperliquid",
  chartMarket: "perp",
  chartSource: "auto",
  showChart: true,
  chartSymbol: "BTC",
  chartInterval: "1h",
  chartFavoriteIntervals: DEFAULT_FAVORITE_INTERVALS,
  timeZone: "UTC",
  showScrollbars: true,
  framedLayout: true,
  containerHeaders: true,
  showSidebar: true,
  navMode: "sidebar",
  tapePosition: "top",
  fitToScreen: false,
  toastPosition: "top",
  showTopBar: true,
  sidebarHiding: false,
  topBarHiding: false,
  tapeSymbols: null,
  tapeMarket: DEFAULT_TAPE_MARKET,
  tapeSource: DEFAULT_TAPE_SOURCE,
  tapeMotion: "left",
  tapeSpeed: "normal",
  dragContainers: true,
  showAlertBell: true,
  alertToasts: true,
  alertSound: "chime",
  alertVolume: 70,
  newsSound: "none",
  newsSoundMinImpact: 0,
  newsSoundBySentiment: false,
  newsSoundPositive: "rise",
  newsSoundNegative: "fall",
  newsSoundSentimentThreshold: 0.3,
  oneClickTrading: false,
  autoRoute: true,
  panels: defaultPanels,
  highImpactThreshold: 80,
  highImpactSound: false,
  newsNotifications: false,
  newsTranslate: true,
  newsRules: [],
  watchlist: [],
  defaultPerpUsd: null,
  defaultSpotUsd: null,
  tradeMinImpact: 60,
  newsLeverage: 5,
  positionsHeight: null,
  swapSlippageBps: null,
  panelSizes: defaultPanelSizes,
  arrangement: defaultArrangement,
  positionsLayout: "grouped",
  appearanceVersion: APPEARANCE_VERSION,
  venueHyperliquid: venueAvailable("hyperliquid"),
  venueLighter: venueAvailable("lighter"),
  venueLighterRh: venueAvailable("lighterRh"),
  venueJupiter: venueAvailable("jupiter"),
  venueArcus: venueAvailable("arcus"),
  venueUniswap: venueAvailable("uniswap"),
  venueTitan: venueAvailable("titan"),
  preferredPerpVenue: "hyperliquid",
  newsFilters: defaultNewsFilters,
  ...defaultAppearance,
};

function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function readDataSource(value: unknown): ChartDataSource | null {
  return value === "binance" || value === "hyperliquid" ? value : null;
}

function readSize(value: unknown) {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) && number > 0 ? Math.min(1_000_000, number) : null;
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readSound(value: unknown, fallback: AlertSound): AlertSound {
  return alertSounds.find((sound) => sound === value) ?? fallback;
}

function readRange(value: unknown, min: number, max: number, step: number, fallback: number) {
  const number = Number(value);
  if (value === undefined || value === null || !Number.isFinite(number)) return fallback;
  return Number((Math.round(Math.min(max, Math.max(min, number)) / step) * step).toFixed(2));
}

function readNewsFilters(value: unknown): NewsFilters {
  const stored = (value ?? {}) as Partial<Record<keyof NewsFilters, unknown>>;
  const pickList = <T extends string>(list: unknown, allowed: T[]) =>
    Array.isArray(list) ? allowed.filter((entry) => list.includes(entry)) : [...allowed];
  return {
    assets: readTapeSymbols(stored.assets) ?? [],
    sentiments: pickList(stored.sentiments, sentiments),
    severities: pickList(stored.severities, severities),
    minImpact: readRange(stored.minImpact, 0, 100, 1, defaultNewsFilters.minImpact),
    showRaw: readBoolean(stored.showRaw, defaultNewsFilters.showRaw),
  };
}

export function parsePreferences(raw: string | null): Preferences {
  try {
    const stored = JSON.parse(raw ?? "{}");
    const primary = readDataSource(stored.chartPrimarySource) ?? defaultPreferences.chartPrimarySource;
    const fallback =
      stored.chartFallbackSource === "none" ? "none" : readDataSource(stored.chartFallbackSource);
    return {
      chart: stored.chart === "tradingview" ? "tradingview" : "angler",
      chartPrimarySource: primary,
      chartFallbackSource:
        fallback === null || fallback === primary
          ? chartDataSources.find((source) => source.value !== primary)!.value
          : fallback,
      chartMarket: stored.chartMarket === "spot" ? "spot" : "perp",
      chartSource: (["hyperliquid", "lighter", "binance"] as const).find((source) => source === stored.chartSource) ?? "auto",
      showChart: readBoolean(stored.showChart, defaultPreferences.showChart),
      chartSymbol:
        typeof stored.chartSymbol === "string" && /^[A-Za-z0-9]{1,20}$/.test(stored.chartSymbol)
          ? stored.chartSymbol
          : defaultPreferences.chartSymbol,
      chartInterval: isChartInterval(stored.chartInterval) ? stored.chartInterval : defaultPreferences.chartInterval,
      chartFavoriteIntervals: Array.isArray(stored.chartFavoriteIntervals)
        ? [...new Set((stored.chartFavoriteIntervals as unknown[]).filter(isChartInterval))]
        : defaultPreferences.chartFavoriteIntervals,
      timeZone: isValidTimeZone(stored.timeZone) ? stored.timeZone : defaultPreferences.timeZone,
      showScrollbars: readBoolean(stored.showScrollbars, defaultPreferences.showScrollbars),
      framedLayout: readBoolean(stored.framedLayout, defaultPreferences.framedLayout),
      containerHeaders: readBoolean(stored.containerHeaders, defaultPreferences.containerHeaders),
      // The terminal always offers the hide buttons (angler-news gates them behind sidebarHiding / topBarHiding).
      showSidebar: readBoolean(stored.showSidebar, true),
      navMode: stored.navMode === "top" ? "top" : "sidebar",
      tapePosition: stored.tapePosition === "bottom" || stored.tapePosition === "off" ? stored.tapePosition : "top",
      fitToScreen: readBoolean(stored.fitToScreen, defaultPreferences.fitToScreen),
      toastPosition: stored.toastPosition === "top-right" || stored.toastPosition === "bottom-right" ? stored.toastPosition : "top",
      showTopBar: readBoolean(stored.showTopBar, true),
      sidebarHiding: readBoolean(stored.sidebarHiding, defaultPreferences.sidebarHiding),
      topBarHiding: readBoolean(stored.topBarHiding, defaultPreferences.topBarHiding),
      tapeSymbols: readTapeSymbols(stored.tapeSymbols),
      tapeMarket: isMarketType(stored.tapeMarket) ? stored.tapeMarket : DEFAULT_TAPE_MARKET,
      tapeSource: isMarketSource(stored.tapeSource) ? stored.tapeSource : DEFAULT_TAPE_SOURCE,
      tapeMotion: tapeMotions.includes(stored.tapeMotion) ? stored.tapeMotion : "left",
      tapeSpeed: tapeSpeeds.includes(stored.tapeSpeed) ? stored.tapeSpeed : "normal",
      dragContainers: readBoolean(stored.dragContainers, defaultPreferences.dragContainers),
      showAlertBell: readBoolean(stored.showAlertBell, defaultPreferences.showAlertBell),
      alertToasts: readBoolean(stored.alertToasts, defaultPreferences.alertToasts),
      alertSound: alertSounds.includes(stored.alertSound) ? stored.alertSound : defaultPreferences.alertSound,
      alertVolume: Number.isFinite(stored.alertVolume)
        ? Math.min(100, Math.max(0, Math.round(stored.alertVolume)))
        : defaultPreferences.alertVolume,
      newsSound: readSound(stored.newsSound, defaultPreferences.newsSound),
      newsSoundMinImpact: readRange(stored.newsSoundMinImpact, 0, 100, 1, defaultPreferences.newsSoundMinImpact),
      newsSoundBySentiment: readBoolean(stored.newsSoundBySentiment, defaultPreferences.newsSoundBySentiment),
      newsSoundPositive: readSound(stored.newsSoundPositive, defaultPreferences.newsSoundPositive),
      newsSoundNegative: readSound(stored.newsSoundNegative, defaultPreferences.newsSoundNegative),
      newsSoundSentimentThreshold: readRange(
        stored.newsSoundSentimentThreshold,
        0,
        1,
        0.05,
        defaultPreferences.newsSoundSentimentThreshold,
      ),
      oneClickTrading: readBoolean(stored.oneClickTrading, defaultPreferences.oneClickTrading),
      autoRoute: readBoolean(stored.autoRoute, defaultPreferences.autoRoute),
      panels: readPanels(stored.panels),
      highImpactThreshold: readRange(stored.highImpactThreshold, 0, 100, 1, defaultPreferences.highImpactThreshold),
      highImpactSound: readBoolean(stored.highImpactSound, defaultPreferences.highImpactSound),
      newsNotifications: readBoolean(stored.newsNotifications, defaultPreferences.newsNotifications),
      newsTranslate: readBoolean(stored.newsTranslate, defaultPreferences.newsTranslate),
      newsRules: readNewsRules(stored.newsRules),
      watchlist: readWatchlist(stored.watchlist),
      defaultPerpUsd: readSize(stored.defaultPerpUsd),
      defaultSpotUsd: readSize(stored.defaultSpotUsd),
      tradeMinImpact: readRange(stored.tradeMinImpact, 0, 100, 1, defaultPreferences.tradeMinImpact),
      newsLeverage: readRange(stored.newsLeverage, 1, 50, 1, defaultPreferences.newsLeverage),
      positionsHeight: stored.positionsHeight == null ? null : readRange(stored.positionsHeight, 80, 2000, 1, 240),
      swapSlippageBps: readSlippageBps(stored.swapSlippageBps),
      panelSizes: readPanelSizes(stored.panelSizes),
      arrangement: readArrangement(stored.arrangement),
      positionsLayout: stored.positionsLayout === "list" ? "list" : "grouped",
      appearanceVersion: APPEARANCE_VERSION,
      venueHyperliquid: venueAvailable("hyperliquid") && readBoolean(stored.venueHyperliquid, defaultPreferences.venueHyperliquid),
      venueLighter: venueAvailable("lighter") && readBoolean(stored.venueLighter, defaultPreferences.venueLighter),
      venueLighterRh: venueAvailable("lighterRh") && readBoolean(stored.venueLighterRh, defaultPreferences.venueLighterRh),
      // Venues this site can't run (testnet: Jupiter/Titan; mainnet: anything not configured) stay off.
      venueJupiter: venueAvailable("jupiter") && readBoolean(stored.venueJupiter, defaultPreferences.venueJupiter),
      venueArcus: venueAvailable("arcus") && readBoolean(stored.venueArcus, defaultPreferences.venueArcus),
      venueUniswap: venueAvailable("uniswap") && readBoolean(stored.venueUniswap, defaultPreferences.venueUniswap),
      venueTitan: venueAvailable("titan") && readBoolean(stored.venueTitan, defaultPreferences.venueTitan),
      preferredPerpVenue: stored.preferredPerpVenue === "lighter" || stored.preferredPerpVenue === "lighterRh" ? stored.preferredPerpVenue : "hyperliquid",
      newsFilters: readNewsFilters(stored.newsFilters),
      ...readAppearance(
        stored.appearanceVersion === APPEARANCE_VERSION ? stored : { ...stored, theme: undefined, surfaceStyle: undefined },
      ),
    };
  } catch {
    return defaultPreferences;
  }
}

const TAPE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function syncCookie(name: string, value: string) {
  const current = document.cookie.split("; ").find((entry) => entry.startsWith(`${name}=`));
  if (current !== `${name}=${value}`) {
    document.cookie = `${name}=${value}; path=/; max-age=${TAPE_COOKIE_MAX_AGE}; samesite=lax`;
  }
}

/** The server renders the tape and the chart's asset and price from these cookies (it can't read localStorage). */
function syncServerCookies(preferences: Preferences) {
  syncCookie(
    TAPE_COOKIE,
    serializeTapeCookie({ market: preferences.tapeMarket, source: preferences.tapeSource, symbols: preferences.tapeSymbols }),
  );
  syncCookie(
    CHART_COOKIE,
    serializeChartCookie({ symbol: preferences.chartSymbol, market: preferences.chartMarket, source: preferences.tapeSource }),
  );
}

export function applyPreferencesToDocument(preferences: Preferences) {
  applyAppearance(preferences, document.documentElement, CUSTOM_CSS_ELEMENT_ID);
  syncServerCookies(preferences);
  const { dataset } = document.documentElement;
  if (preferences.showScrollbars) delete dataset.scrollbars;
  else dataset.scrollbars = "hidden";
  if (preferences.framedLayout) delete dataset.frame;
  else dataset.frame = "off";
  if (preferences.showSidebar) delete dataset.sidebar;
  else dataset.sidebar = "hidden";
  if (preferences.showTopBar) delete dataset.topbar;
  else dataset.topbar = "hidden";
  if (preferences.navMode === "top") dataset.nav = "top";
  else delete dataset.nav;
  if (preferences.tapePosition === "top") delete dataset.tape;
  else dataset.tape = preferences.tapePosition;
  if (preferences.fitToScreen) dataset.viewport = "fit";
  else delete dataset.viewport;
}

export const preferencesScript = `try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(
  PREFERENCES_STORAGE_KEY,
)})||"{}"),d=document.documentElement.dataset;if(p.appearanceVersion!==${APPEARANCE_VERSION}){delete p.theme;delete p.surfaceStyle}if(p.showScrollbars===false)d.scrollbars="hidden";if(p.framedLayout===false)d.frame="off";if(p.showSidebar===false)d.sidebar="hidden";if(p.showTopBar===false)d.topbar="hidden";if(p.navMode==="top")d.nav="top";if(p.tapePosition==="bottom"||p.tapePosition==="off")d.tape=p.tapePosition;if(p.fitToScreen===true)d.viewport="fit";(${applyAppearance.toString()})(p,document.documentElement,${JSON.stringify(
  CUSTOM_CSS_ELEMENT_ID,
)})}catch(e){}`;
