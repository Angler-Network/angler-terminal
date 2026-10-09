/**
 * Alert settings a profile keeps on the server (Profile → Alerts): where to send (Discord webhook, Telegram chat) and
 * what to watch (positions, liquidation distance, news, price levels). Pure: shared by the page and the API routes.
 */

export interface PriceAlert {
  id: string;
  /** Hyperliquid coin, e.g. "BTC" or "xyz:NVDA" for a stock perp. */
  coin: string;
  direction: "above" | "below";
  price: number;
}

export interface AlertSettings {
  discordWebhook: string | null;
  /** Set by the Telegram bot when the user sends it their link code; the page can only clear it. */
  telegramChatId: string | null;
  /** Position opened, closed, added to, reduced or flipped (Hyperliquid and Lighter). */
  positions: boolean;
  /** Warn once a position is within this many percent of its liquidation price; null = off. */
  liquidationPct: number | null;
  /** News at or above this impact on the watched coins; null = off. */
  newsMinImpact: number | null;
  /** Watch the coins of open positions for news. */
  newsHeld: boolean;
  /** More coins to watch for news. */
  newsCoins: string[];
  prices: PriceAlert[];
}

export const MAX_PRICE_ALERTS = 20;
export const MAX_NEWS_COINS = 20;
export const LIQUIDATION_STEPS = [5, 10, 20] as const;
export const NEWS_IMPACT_STEPS = [60, 70, 80, 90] as const;

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  discordWebhook: null,
  telegramChatId: null,
  positions: true,
  liquidationPct: 10,
  newsMinImpact: null,
  newsHeld: true,
  newsCoins: [],
  prices: [],
};

// Discord's own hosts only: the server posts to this URL, so anything else would let a profile make it call any host.
const DISCORD_WEBHOOK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,30}\/[\w-]{20,100}$/;
const COIN = /^(?:[a-z0-9]{1,12}:)?k?[A-Z0-9]{1,20}$/;
const ALERT_ID = /^[\w-]{1,40}$/;

export function isDiscordWebhook(url: string) {
  return DISCORD_WEBHOOK.test(url);
}

/**
 * Normalizes a typed coin ("btc", "xyz:nvda") to Hyperliquid's naming, or null when it isn't one. Hyperliquid's
 * thousand-unit coins keep their lowercase "k" (kPEPE, kBONK) when given that way.
 */
export function normalizeCoin(value: string) {
  const trimmed = value.trim();
  const [dex, raw] = trimmed.includes(":") ? trimmed.split(":", 2) : [null, trimmed];
  const name = /^k[A-Z0-9]+$/.test(raw) ? raw : raw.toUpperCase();
  const coin = dex ? `${dex.toLowerCase()}:${name}` : name;
  return COIN.test(coin) ? coin : null;
}

type Result = { ok: true; settings: AlertSettings } | { ok: false; error: string };

/**
 * Validates settings sent by the page. `telegramChatId` is never taken from the request: it stays as stored
 * (`current`), so only the bot can link a chat.
 */
export function readAlertSettings(value: unknown, current: AlertSettings = DEFAULT_ALERT_SETTINGS): Result {
  if (!value || typeof value !== "object") return { ok: false, error: "Invalid settings." };
  const input = value as Record<string, unknown>;

  const webhook = typeof input.discordWebhook === "string" ? input.discordWebhook.trim() : "";
  if (webhook && !isDiscordWebhook(webhook)) return { ok: false, error: "That isn't a Discord webhook URL (https://discord.com/api/webhooks/…)." };

  const liquidationPct = input.liquidationPct === null ? null : Number(input.liquidationPct);
  if (liquidationPct !== null && !(LIQUIDATION_STEPS as readonly number[]).includes(liquidationPct)) return { ok: false, error: "Invalid liquidation distance." };
  const newsMinImpact = input.newsMinImpact === null ? null : Number(input.newsMinImpact);
  if (newsMinImpact !== null && !(NEWS_IMPACT_STEPS as readonly number[]).includes(newsMinImpact)) return { ok: false, error: "Invalid news impact." };

  const coins = Array.isArray(input.newsCoins) ? input.newsCoins : [];
  if (coins.length > MAX_NEWS_COINS) return { ok: false, error: `Watch at most ${MAX_NEWS_COINS} coins for news.` };
  const newsCoins: string[] = [];
  for (const entry of coins) {
    const coin = typeof entry === "string" ? normalizeCoin(entry) : null;
    if (!coin) return { ok: false, error: `"${String(entry)}" isn't a coin.` };
    if (!newsCoins.includes(coin)) newsCoins.push(coin);
  }

  const rawPrices = Array.isArray(input.prices) ? input.prices : [];
  if (rawPrices.length > MAX_PRICE_ALERTS) return { ok: false, error: `At most ${MAX_PRICE_ALERTS} price alerts.` };
  const prices: PriceAlert[] = [];
  for (const entry of rawPrices) {
    const alert = (entry ?? {}) as Record<string, unknown>;
    const coin = typeof alert.coin === "string" ? normalizeCoin(alert.coin) : null;
    const price = Number(alert.price);
    if (!coin || !(price > 0) || !Number.isFinite(price)) return { ok: false, error: "Each price alert needs a coin and a price above 0." };
    if (alert.direction !== "above" && alert.direction !== "below") return { ok: false, error: "Invalid price alert direction." };
    if (typeof alert.id !== "string" || !ALERT_ID.test(alert.id)) return { ok: false, error: "Invalid price alert." };
    prices.push({ id: alert.id, coin, direction: alert.direction, price });
  }

  return {
    ok: true,
    settings: {
      discordWebhook: webhook || null,
      telegramChatId: current.telegramChatId,
      positions: Boolean(input.positions),
      liquidationPct,
      newsMinImpact,
      newsHeld: Boolean(input.newsHeld),
      newsCoins,
      prices,
    },
  };
}

/** Reads stored settings, falling back to the defaults for anything missing or broken. */
export function parseStoredSettings(raw: string | undefined | null): AlertSettings {
  if (!raw) return DEFAULT_ALERT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<AlertSettings>;
    const chat = typeof parsed.telegramChatId === "string" ? parsed.telegramChatId : null;
    const result = readAlertSettings(parsed, { ...DEFAULT_ALERT_SETTINGS, telegramChatId: chat });
    return result.ok ? result.settings : { ...DEFAULT_ALERT_SETTINGS, telegramChatId: chat };
  } catch {
    return DEFAULT_ALERT_SETTINGS;
  }
}

export function hasChannel(settings: AlertSettings) {
  return Boolean(settings.discordWebhook || settings.telegramChatId);
}

/**
 * The bot's username from however it was entered: "angleralertsbot", "@angleralertsbot" or a t.me link. A full link in
 * the setting once made the bot link "t.me/https://t.me/…", so Connect Telegram opened nothing.
 */
export function readBotUsername(value: string | undefined) {
  const name = (value ?? "")
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  return /^\w{5,32}$/.test(name) ? name : null;
}
