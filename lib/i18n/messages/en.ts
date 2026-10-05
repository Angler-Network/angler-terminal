/** The English strings the reused angler-news components need. The terminal ships in English only. */
export const en = {
  "time.now": "now",
  "time.minutes": "{n}m",
  "time.hours": "{n}h",
  "time.days": "{n}d",
  "top.tickers": "Market tickers",
  "severity.breaking": "Breaking",
  "severity.important": "Important",
  "severity.notable": "Notable",
  "news.alertSet": "Alert set",
  "news.marketReaction": "Market reaction",
  "news.moreSources": "+{n} more",
  "settings.tapeSearch": "Search by symbol, e.g. BTC or NVDA",
  "settings.tapeNoMatch": "No market matches your search.",
  "settings.tapeCrypto": "Crypto",
  "settings.tapeStock": "Stock",
  "studio.impact": "Impact score",
  "market.up": "Up",
  "market.down": "Down",
  "chart.title": "Chart",
  "chart.symbol": "Symbol",
  "chart.interval": "Interval",
  "chart.label": "{symbol} price chart",
  "chart.unavailable": "No price data for this symbol right now.",
  "update.title": "New version available",
  "update.text": "Refresh to get the latest version ({version}).",
  "update.dismiss": "Dismiss update notice",
  "about.refresh": "Refresh",
} as const;

export type MessageKey = keyof typeof en;

export type AllMessages = Record<MessageKey, string>;
