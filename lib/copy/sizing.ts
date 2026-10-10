import { coinSymbol, type LeaderEvent } from "./events";
import type { CopySettings } from "./follows";

/**
 * How one leader event becomes orders on the follower's side. Opens are sized by the follower's settings (a fixed USD
 * amount or a share of the leader's size, capped); adds, reductions and closes follow the leader in proportion to what
 * was copied, so the copy keeps the leader's shape whatever its size. Positions the leader held before copying started
 * are never touched.
 */

/** "open" opens or adds (`usd` for a new copy, `size` in base units for an add); "reduce" is reduce-only, `size` in base units. */
export interface CopyStep {
  action: "open" | "reduce";
  side: "buy" | "sell";
  usd?: number;
  size?: number;
}

export interface CopyPlan {
  steps: CopyStep[];
  /** Why nothing (or less) was copied, for the activity log. */
  note?: string;
}

const sideFor = (size: number): "buy" | "sell" => (size > 0 ? "buy" : "sell");
const closingSide = (size: number): "buy" | "sell" => (size > 0 ? "sell" : "buy");

/** USD for a new copy of a leader position of `size` at `price`. */
export function openUsd(settings: CopySettings, size: number, price: number) {
  const usd = settings.sizing === "fixed" ? settings.usd : (Math.abs(size) * price * settings.ratio) / 100;
  return Math.min(usd, settings.maxUsd);
}

/** Whether the follower copies this coin at all (closing a copy already held always goes through). */
export function copiesCoin(settings: CopySettings, coin: string) {
  return settings.coins.length === 0 || settings.coins.includes(coinSymbol(coin).toUpperCase());
}

/**
 * The orders for `event`. `held` is the signed base size this copy holds of the coin (0 when nothing was copied).
 */
export function copyPlan(event: LeaderEvent, settings: CopySettings, held: number): CopyPlan {
  const price = event.price;
  if (!(price > 0)) return { steps: [], note: "No price for this change." };
  const wanted = copiesCoin(settings, event.coin);
  switch (event.kind) {
    case "open":
      if (!wanted) return { steps: [], note: "Coin not in the copy list." };
      return { steps: [{ action: "open", side: sideFor(event.after), usd: openUsd(settings, event.after, price) }] };
    case "add": {
      if (held === 0) return { steps: [], note: "Opened before copying started." };
      if (!wanted) return { steps: [], note: "Coin not in the copy list." };
      const share = (Math.abs(event.after) - Math.abs(event.before)) / Math.abs(event.before);
      const room = settings.maxUsd / price - Math.abs(held);
      const size = Math.min(Math.abs(held) * share, room);
      if (!(size > 0)) return { steps: [], note: "Copy already at its cap." };
      return { steps: [{ action: "open", side: sideFor(event.after), size }] };
    }
    case "reduce": {
      if (held === 0) return { steps: [], note: "Opened before copying started." };
      const share = (Math.abs(event.before) - Math.abs(event.after)) / Math.abs(event.before);
      return { steps: [{ action: "reduce", side: closingSide(held), size: Math.abs(held) * share }] };
    }
    case "close":
      if (held === 0) return { steps: [], note: "Opened before copying started." };
      return { steps: [{ action: "reduce", side: closingSide(held), size: Math.abs(held) }] };
    case "flip": {
      const steps: CopyStep[] = [];
      if (held !== 0) steps.push({ action: "reduce", side: closingSide(held), size: Math.abs(held) });
      if (wanted) steps.push({ action: "open", side: sideFor(event.after), usd: openUsd(settings, event.after, price) });
      return { steps, note: wanted ? undefined : "Coin not in the copy list." };
    }
  }
}
