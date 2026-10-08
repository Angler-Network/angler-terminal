import { afterEach, describe, expect, it } from "vitest";
import { nextVip, setVipRate, tierFee, tierFees, vipFee, vipFor } from "./vip";

describe("VIP tiers", () => {
  afterEach(() => setVipRate(1));

  it("picks the tier by 30-day volume", () => {
    expect(vipFor(0).level).toBe(0);
    expect(vipFor(99_999).level).toBe(0);
    expect(vipFor(100_000).level).toBe(1);
    expect(vipFor(3_000_000).level).toBe(3);
    expect(vipFor(50_000_000).level).toBe(4);
    expect(nextVip(vipFor(50_000_000))).toBeNull();
    expect(nextVip(vipFor(0))?.minVolume).toBe(100_000);
  });

  it("scales a configured fee in the venue's integer unit", () => {
    // Hyperliquid at 3.5 bps (35 tenths): 3.5, 3.3, 3.0, 2.8, 2.5 bps.
    expect(tierFees(35)).toEqual([35, 33, 30, 28, 25]);
    expect(tierFee(0, 0.5)).toBe(0);
    expect(tierFee(1, 0.7)).toBe(1);
    setVipRate(vipFor(600_000).rate);
    expect(vipFee(35)).toBe(30);
    // Lighter in millionths: 350 (3.5 bps) at VIP 2.
    expect(vipFee(350)).toBe(300);
  });
});
