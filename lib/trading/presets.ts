import { spotSizePresets } from "@/lib/venues/jupiter/config";

export type TradeVenueKind = "perp" | "spot";

/**
 * USD size presets per venue. Development stays small. Hyperliquid rejects orders under $10 notional, so perp
 * presets start there.
 */
export function perpSizePresets(env: { NODE_ENV?: string; NEXT_PUBLIC_PERP_SIZE_PRESETS?: string }) {
  const custom = (env.NEXT_PUBLIC_PERP_SIZE_PRESETS ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (custom.length > 0) return custom.slice(0, 3);
  return env.NODE_ENV === "production" ? [100, 250, 1000] : [10, 25, 50];
}

export const sizePresets: Record<TradeVenueKind, number[]> = {
  perp: perpSizePresets({ NODE_ENV: process.env.NODE_ENV, NEXT_PUBLIC_PERP_SIZE_PRESETS: process.env.NEXT_PUBLIC_PERP_SIZE_PRESETS }),
  spot: spotSizePresets({ NODE_ENV: process.env.NODE_ENV, NEXT_PUBLIC_SPOT_SIZE_PRESETS: process.env.NEXT_PUBLIC_SPOT_SIZE_PRESETS }).slice(0, 3),
};

/** The size a news trade starts with: the user's default if set, else the venue's first preset. */
export function defaultSize(kind: TradeVenueKind, preference: number | null) {
  return preference && preference > 0 ? preference : sizePresets[kind][0];
}

/** Side labels per venue: perps go long/short, spot buys/sells. */
export function sideLabel(kind: TradeVenueKind, side: "buy" | "sell") {
  if (kind === "perp") return side === "buy" ? "Long" : "Short";
  return side === "buy" ? "Buy" : "Sell";
}
