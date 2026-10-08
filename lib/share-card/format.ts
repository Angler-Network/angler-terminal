/**
 * The PnL share card's data: one position, normalized across venues, and how its numbers are written. Ported from the
 * design kit (design-kits/share-cards/src/format.js).
 */

export interface TradeData {
  symbol: string;
  /** The market's logo (same-origin, so the PNG export can read it); without one, BTC/ETH/SOL are drawn and others get initials. */
  symbolIcon?: string;
  market: string;
  direction: "long" | "short";
  leverage: number;
  /** Return on margin in percent: 38.46 is +38.46%. */
  roi: number;
  /** USD PnL. */
  pnl: number;
  venue: string;
  /** The venue's logo, drawn beside its name; same-origin so the PNG export can read it. */
  venueIcon?: string;
  showVenue: boolean;
  /** Printed in the footer. */
  domain: string;
  /** Encoded in the QR code. */
  url: string;
  hidePnl: boolean;
}

export type TradeInput = Pick<TradeData, "symbol" | "direction" | "leverage" | "roi" | "pnl"> & Partial<Omit<TradeData, "symbol" | "direction" | "leverage" | "roi" | "pnl">>;

export type DesignId = "velocity" | "polar" | "eclipse" | "orbit" | "relay" | "mono";

export const DEFAULT_DATA: Readonly<TradeData> = Object.freeze({
  symbol: "BTC",
  market: "PERP",
  direction: "long",
  leverage: 10,
  roi: 38.46,
  pnl: 961.54,
  venue: "Hyperliquid",
  showVenue: false,
  domain: "trade.angler.network",
  url: "https://trade.angler.network",
  hidePnl: false,
});

/** `asset` is the design's text-free 3D artwork; `hue` is that artwork's own hue, which palettes rotate from. */
export const DESIGNS: ReadonlyArray<{ id: DesignId; name: string; accent: string; asset: string; hue: number }> = Object.freeze([
  { id: "velocity", name: "Velocity", accent: "#8cafff", asset: "cobalt.webp", hue: 264 },
  { id: "polar", name: "Polar", accent: "#b6cff1", asset: "polar.webp", hue: 253 },
  { id: "eclipse", name: "Eclipse", accent: "#aab0ff", asset: "eclipse.webp", hue: 279 },
  { id: "orbit", name: "Orbit", accent: "#b8d7ff", asset: "orbit.webp", hue: 264 },
  { id: "relay", name: "Relay", accent: "#aec9ff", asset: "relay.webp", hue: 266 },
  { id: "mono", name: "Mono", accent: "#e9edf6", asset: "mono.webp", hue: 259 },
]);

/** Fills the display defaults; the financial fields must be on the record, so a broken one throws rather than showing a made-up trade. */
export function normalizeData(input: TradeInput): TradeData {
  const d: TradeData = { ...DEFAULT_DATA, ...input };
  for (const key of ["roi", "pnl", "leverage"] as const) {
    if (typeof input[key] !== "number" || !Number.isFinite(input[key])) throw new TypeError(`${key} must be a finite number`);
  }
  if (d.leverage <= 0) throw new RangeError("leverage must be greater than zero");
  if (input.direction !== "long" && input.direction !== "short") throw new TypeError("direction must be long or short");
  for (const key of ["symbol", "market", "venue", "domain", "url"] as const) {
    const value = d[key];
    if (typeof value !== "string" || !value.trim()) throw new TypeError(`${key} must be a nonempty string`);
    d[key] = value.trim();
  }
  d.symbol = d.symbol.toUpperCase();
  d.market = d.market.toUpperCase();
  return d;
}

const number = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });
const sign = (value: number) => (value < 0 ? "−" : value > 0 ? "+" : "");

export const signedPercent = (value: number) => `${sign(value)}${number.format(Math.abs(value))}%`;
export const signedMoney = (value: number) => `${sign(value)}$${number.format(Math.abs(value))}`;
export const leverageText = (value: number) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}×`;

/** The canvas's accessible description; a hidden amount is hidden here too. */
export function dataLabel(d: TradeData) {
  return `${d.symbol} ${d.market}, ${d.direction}, ${leverageText(d.leverage)}, return ${signedPercent(d.roi)}, PnL ${d.hidePnl ? "hidden" : signedMoney(d.pnl)}${d.showVenue ? `, executed on ${d.venue}` : ""}`;
}
