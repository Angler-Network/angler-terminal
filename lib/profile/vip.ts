/**
 * VIP fee tiers: the more a profile traded through Angler in the last 30 days, the less of our own fee it pays (the
 * venues' fees don't change). Each tier is a share of the configured fee, so one table covers every venue: with the
 * Hyperliquid builder fee at 3.5 bps, VIP 1 pays 3.25, VIP 4 pays 2.5. Pure, unit-tested.
 */

export interface VipTier {
  level: number;
  /** 30-day volume through Angler from which the tier applies. */
  minVolume: number;
  /** Share of the configured fee charged. */
  rate: number;
}

export const VIP_TIERS: VipTier[] = [
  { level: 0, minVolume: 0, rate: 1 },
  { level: 1, minVolume: 100_000, rate: 32.5 / 35 },
  { level: 2, minVolume: 500_000, rate: 30 / 35 },
  { level: 3, minVolume: 2_500_000, rate: 27.5 / 35 },
  { level: 4, minVolume: 10_000_000, rate: 25 / 35 },
];

export function vipFor(volume30d: number): VipTier {
  let tier = VIP_TIERS[0];
  for (const entry of VIP_TIERS) if (volume30d >= entry.minVolume) tier = entry;
  return tier;
}

export function nextVip(tier: VipTier): VipTier | null {
  return VIP_TIERS.find((entry) => entry.level === tier.level + 1) ?? null;
}

/**
 * A configured fee at a tier, in the venue's own integer unit (Hyperliquid tenths of a bp, Lighter millionths): never
 * above the configured fee, and a configured fee stays non-zero.
 */
export function tierFee(baseFee: number, rate: number) {
  if (!(baseFee > 0)) return 0;
  return Math.min(baseFee, Math.max(1, Math.round(baseFee * rate)));
}

/** Every fee a tier can charge for a configured fee: a fill paying any of them came through Angler. */
export function tierFees(baseFee: number) {
  return [...new Set(VIP_TIERS.map((tier) => tierFee(baseFee, tier.rate)))];
}

// ---------- the browser's current tier ----------

let currentRate = 1;

/** Set from the connected profile's 30-day volume; venues read it when they sign an order. */
export function setVipRate(rate: number) {
  currentRate = rate > 0 && rate <= 1 ? rate : 1;
}

/** The configured fee at the connected profile's tier. */
export function vipFee(baseFee: number) {
  return tierFee(baseFee, currentRate);
}
