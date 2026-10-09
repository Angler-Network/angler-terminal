import { formatPrice } from "@/lib/format";
import type { AlertSettings, PriceAlert } from "./settings";

/**
 * What the alerts tick decides each minute, as pure functions over snapshots: position changes, liquidation
 * distance, price levels and news. Each returns the messages to send and the state to keep for the next tick.
 */

export type AlertVenue = "hyperliquid" | "lighter" | "lighterRh";

export const VENUE_NAMES: Record<AlertVenue, string> = { hyperliquid: "Hyperliquid", lighter: "Lighter", lighterRh: "Lighter RH" };

/** One open position as the venues report it (signed size: positive long). */
export interface PositionSnap {
  venue: AlertVenue;
  coin: string;
  size: number;
  entryPx: number;
  /** Mark price, from position value / size. */
  markPx: number;
  liquidationPx: number | null;
  unrealizedPnl: number;
}

/** What a profile's alerts remember between ticks. */
export interface AlertState {
  /** Positions last seen, by `venue:coin`; null until the first tick has looked (nothing is reported then). */
  positions: Record<string, PositionSnap> | null;
  /** Positions already warned about their liquidation distance. */
  liqWarned: string[];
  /** Price alerts that fired (each fires once; deleting and re-adding arms it again). */
  firedPrices: string[];
  /** Lighter account index per venue, looked up once (null: no account yet, looked up again later). */
  lighterAccounts?: Partial<Record<AlertVenue, { index: number | null; at: number }>>;
}

export const EMPTY_STATE: AlertState = { positions: null, liqWarned: [], firedPrices: [] };

export function positionKey(position: Pick<PositionSnap, "venue" | "coin">) {
  return `${position.venue}:${position.coin}`;
}

function sideOf(size: number) {
  return size > 0 ? "long" : "short";
}

/** Strips the HIP-3 dex prefix for display ("xyz:NVDA" → "NVDA"). */
/** Price alerts priced on Lighter, Lighter RH or Aster carry that venue as the prefix ("aster:BTC"). */
export const PRICE_VENUE_PREFIXES = { lighter: "Lighter", lighterrh: "Lighter RH", aster: "Aster" } as const;

/** The venue a price alert's coin is priced on, when it isn't Hyperliquid. */
export function priceVenueName(coin: string): string | null {
  const prefix = coin.includes(":") ? coin.split(":")[0] : "";
  return prefix in PRICE_VENUE_PREFIXES ? PRICE_VENUE_PREFIXES[prefix as keyof typeof PRICE_VENUE_PREFIXES] : null;
}

export function displayCoin(coin: string) {
  return coin.includes(":") ? coin.split(":")[1] : coin;
}

function signedUsd(value: number) {
  return `${value >= 0 ? "+" : "-"}${formatPrice(Math.abs(value))}`;
}

function amount(value: number) {
  return Number(Math.abs(value).toPrecision(8)).toString();
}

/** Opened, closed, added to, reduced and flipped positions between two snapshots. */
export function positionMessages(previous: Record<string, PositionSnap>, current: Record<string, PositionSnap>): string[] {
  const messages: string[] = [];
  for (const [key, now] of Object.entries(current)) {
    const before = previous[key];
    const where = `${displayCoin(now.coin)} on ${VENUE_NAMES[now.venue]}`;
    if (!before) {
      messages.push(`🟢 Opened ${sideOf(now.size)} ${amount(now.size)} ${where} at ${formatPrice(now.entryPx)}`);
    } else if (Math.sign(before.size) !== Math.sign(now.size)) {
      messages.push(`🔁 Flipped ${where} to ${sideOf(now.size)} ${amount(now.size)} at ${formatPrice(now.entryPx)}`);
    } else if (Math.abs(now.size) > Math.abs(before.size)) {
      messages.push(`➕ Added to ${sideOf(now.size)} ${where}: ${amount(before.size)} → ${amount(now.size)}, entry ${formatPrice(now.entryPx)}`);
    } else if (Math.abs(now.size) < Math.abs(before.size)) {
      messages.push(`➖ Reduced ${sideOf(now.size)} ${where}: ${amount(before.size)} → ${amount(now.size)} at about ${formatPrice(now.markPx)}`);
    }
  }
  for (const [key, before] of Object.entries(previous)) {
    if (current[key]) continue;
    messages.push(
      `⚪ Closed ${sideOf(before.size)} ${amount(before.size)} ${displayCoin(before.coin)} on ${VENUE_NAMES[before.venue]} near ${formatPrice(before.markPx)} (last uPnL ${signedUsd(before.unrealizedPnl)})`,
    );
  }
  return messages;
}

/** Distance from the mark to the liquidation price, in percent of the mark. */
export function liquidationDistance(position: PositionSnap) {
  if (!position.liquidationPx || !(position.markPx > 0)) return null;
  return (Math.abs(position.markPx - position.liquidationPx) / position.markPx) * 100;
}

/**
 * One warning per position once it gets within `pct` of liquidation. It re-arms after the distance grows past 1.5×
 * `pct` (or the position closes), so a price hovering at the line doesn't warn every minute.
 */
export function liquidationMessages(current: Record<string, PositionSnap>, pct: number | null, warned: string[]) {
  if (pct === null) return { messages: [] as string[], warned: [] as string[] };
  const messages: string[] = [];
  const next: string[] = [];
  for (const [key, position] of Object.entries(current)) {
    const distance = liquidationDistance(position);
    if (distance === null) continue;
    const already = warned.includes(key);
    if (distance <= pct) {
      if (!already) {
        messages.push(
          `⚠️ ${displayCoin(position.coin)} ${sideOf(position.size)} on ${VENUE_NAMES[position.venue]} is ${distance.toFixed(1)}% from liquidation (mark ${formatPrice(position.markPx)}, liq. ${formatPrice(position.liquidationPx!)})`,
        );
      }
      next.push(key);
    } else if (already && distance < pct * 1.5) {
      next.push(key);
    }
  }
  return { messages, warned: next };
}

/** Price alerts whose level the mid has reached; each fires once. */
export function priceMessages(prices: PriceAlert[], mids: Record<string, number>, fired: string[]) {
  const messages: string[] = [];
  const nextFired = fired.filter((id) => prices.some((alert) => alert.id === id));
  for (const alert of prices) {
    if (nextFired.includes(alert.id)) continue;
    const mid = mids[alert.coin];
    if (!(mid > 0)) continue;
    if (alert.direction === "above" ? mid >= alert.price : mid <= alert.price) {
      const venue = priceVenueName(alert.coin);
      messages.push(`🎯 ${displayCoin(alert.coin)}${venue ? ` (${venue})` : ""} is ${alert.direction} ${formatPrice(alert.price)} (now ${formatPrice(mid)})`);
      nextFired.push(alert.id);
    }
  }
  return { messages, fired: nextFired };
}

/** A news item as the alerts read it from /v1/news. */
export interface AlertNews {
  id: number;
  title: string;
  impact: number;
  coins: string[];
  url?: string;
}

/** News at or above the profile's impact on the coins it watches (its positions' coins and its own list). */
export function newsMessages(items: AlertNews[], settings: AlertSettings, heldCoins: string[]) {
  if (settings.newsMinImpact === null) return [];
  const watched = new Set([...settings.newsCoins.map(displayCoin), ...(settings.newsHeld ? heldCoins.map(displayCoin) : [])]);
  if (watched.size === 0) return [];
  return items
    .filter((item) => item.impact >= settings.newsMinImpact! && item.coins.some((coin) => watched.has(coin)))
    .map((item) => {
      const coins = item.coins.filter((coin) => watched.has(coin)).join(", ");
      return `📰 [${item.impact}] ${coins}: ${item.title}${item.url ? `\n${item.url}` : ""}`;
    });
}
