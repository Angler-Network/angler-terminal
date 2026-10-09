import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { creditVolume, readProfile, setReferrer } = await import("./store");
const { setClosedBeta } = await import("@/lib/ops/beta");

describe("Lighter Standard volume", () => {
  beforeAll(() => setClosedBeta(false));
  afterAll(() => setClosedBeta(true));

  it("earns half points but counts in full as volume", async () => {
    const trader = "0x00000000000000000000000000000000000000ab";
    // $10,000 on Lighter, $4,000 of it on a Standard account: 6,000 + 4,000 / 2 = $8,000 worth of points.
    await creditVolume(trader, "lighter", 10_000, 0, 4_000);
    const profile = await readProfile(trader);
    expect(profile.volume.lighter).toBe(10_000);
    expect(profile.points).toBe(0.8);
  });
});

describe("points scaled by our fee", () => {
  it("gives a lower-fee venue its share of points, full points at the perp base or above", async () => {
    const trader = "0x00000000000000000000000000000000000000f1";
    // Uniswap at 1 bp: 1 / 3.5 of the points; 0x at 10 bps: capped at full points; the volume counts in full.
    await creditVolume(trader, "uniswap", 35_000, 3.5, 0, { pointsShare: 1 / 3.5 });
    await creditVolume(trader, "zerox", 10_000, 10, 0, { pointsShare: 1 });
    const profile = await readProfile(trader);
    expect(profile.volume.uniswap).toBe(35_000);
    expect(profile.points).toBe(2);
    // During the beta the share is doubled too: 35,000 × (1 / 3.5) × 2.
    const beta = "0x00000000000000000000000000000000000000f2";
    await creditVolume(beta, "uniswap", 35_000, 3.5, 0, { betaUsd: 35_000, pointsShare: 1 / 3.5 });
    expect((await readProfile(beta)).points).toBe(2);
  });
});

describe("closed beta points", () => {
  it("doubles the points of volume traded during the beta, not the volume", async () => {
    const trader = "0x00000000000000000000000000000000000000e2";
    // All of it during the beta; on Lighter $4,000 Standard (half points), $3,000 of which during the beta.
    await creditVolume(trader, "hyperliquid", 10_000, 0, 0, { betaUsd: 10_000 });
    await creditVolume(trader, "lighter", 10_000, 0, 4_000, { betaUsd: 6_000, betaStandardUsd: 3_000 });
    const profile = await readProfile(trader);
    expect(profile.volume.hyperliquid).toBe(10_000);
    expect(profile.volume.lighter).toBe(10_000);
    // Base 10,000 + 8,000; bonus 10,000 + (6,000 - 3,000 / 2).
    expect(profile.points).toBe(3.25);
    expect(profile.daily.at(-1)).toMatchObject({ usd: 20_000, bonusUsd: 14_500 });
    expect(profile.recentVolume.d30).toBe(20_000);
  });
});

describe("invites", () => {
  // Referral invites as they work once the closed beta is open.
  beforeAll(() => setClosedBeta(false));
  afterAll(() => setClosedBeta(true));

  it("earns one single-use code per $10K and only lets new profiles join with one", async () => {
    const inviter = "0x00000000000000000000000000000000000000a1";
    const newcomer = "0x00000000000000000000000000000000000000b2";
    const second = "0x00000000000000000000000000000000000000c3";
    const trader = "0x00000000000000000000000000000000000000d4";

    expect((await readProfile(inviter, { owner: true })).invites?.codes).toEqual([]);
    await creditVolume(inviter, "hyperliquid", 25_000);
    const { codes, nextAt } = (await readProfile(inviter, { owner: true })).invites!;
    expect(codes).toHaveLength(2);
    expect(nextAt).toBe(30_000);
    // Reading again doesn't mint more.
    expect((await readProfile(inviter, { owner: true })).invites!.codes.map((entry) => entry.code)).toEqual(codes.map((entry) => entry.code));

    const [first] = codes;
    expect(await setReferrer(inviter, first.code)).toMatchObject({ ok: false });
    expect(await setReferrer(newcomer, "NOTACODE")).toMatchObject({ ok: false });
    expect(await setReferrer(newcomer, first.code.toLowerCase())).toEqual({ ok: true, referrer: inviter });
    expect(await setReferrer(second, first.code)).toMatchObject({ ok: false, error: "That invite was already used." });

    await creditVolume(trader, "lighter", 50);
    expect(await setReferrer(trader, codes[1].code)).toMatchObject({ ok: false, error: "Invites only apply to new profiles." });

    // Other visitors don't get the codes.
    expect((await readProfile(inviter)).invites).toBeNull();
    const after = await readProfile(inviter, { owner: true });
    expect(after.referrals).toBe(1);
    expect(after.invites!.codes.find((entry) => entry.code === first.code)?.usedBy).toBe(newcomer);
  });

  it("pays referrers 10% of the fees on perp and spot trades only, and swaps earn no invites", async () => {
    const inviter = "0x00000000000000000000000000000000000000e5";
    const newcomer = "0x00000000000000000000000000000000000000f6";
    await creditVolume(inviter, "jupiter", 50_000);
    expect((await readProfile(inviter, { owner: true })).invites!.codes).toEqual([]);
    await creditVolume(inviter, "lighter", 10_000);
    const [code] = (await readProfile(inviter, { owner: true })).invites!.codes;
    expect(await setReferrer(newcomer, code.code)).toMatchObject({ ok: true });

    await creditVolume(newcomer, "hyperliquid", 100_000, 35);
    await creditVolume(newcomer, "jupiter", 100_000, 500);
    expect((await readProfile(inviter)).referralEarnings).toBe(3.5);

    // Payouts: an admin pays part of it, then the rest; nothing more than is claimable.
    const { readPayables, readPayouts, recordPayout } = await import("./store");
    expect((await readPayables()).find((row) => row.id === inviter)).toMatchObject({ earned: 3.5, paid: 0, claimable: 3.5 });
    expect(await recordPayout(inviter, 2, "0xabc", "0xadmin", 1_000)).toMatchObject({ ok: true, claimable: 1.5 });
    expect(await recordPayout(inviter, 5, "", "0xadmin")).toMatchObject({ ok: false });
    expect(await recordPayout(inviter, 1.5, "", "0xadmin", 2_000)).toMatchObject({ ok: true, claimable: 0 });
    expect(await readProfile(inviter)).toMatchObject({ referralEarnings: 3.5, referralPaid: 3.5, referralClaimable: 0 });
    expect((await readPayouts(inviter)).map((payout) => payout.usd)).toEqual([1.5, 2]);
  });
});

describe("closed beta", () => {
  it("lets in invited, admin and earlier traders, and gives admins codes at will", async () => {
    const admin = "0x00000000000000000000000000000000000000ad";
    const stranger = "0x0000000000000000000000000000000000000a11";
    const veteran = "0x0000000000000000000000000000000000000b22";
    process.env.ANGLER_ADMINS = ` ${admin.toUpperCase().replace("0X", "0x")} `;
    try {
      const { createAdminInvite } = await import("./store");
      expect(await readProfile(admin)).toMatchObject({ access: true, admin: true });
      expect(await readProfile(stranger)).toMatchObject({ access: false, admin: false });
      await creditVolume(veteran, "hyperliquid", 10);
      expect((await readProfile(veteran)).access).toBe(true);

      expect(await createAdminInvite(stranger)).toBeNull();
      const code = await createAdminInvite(admin);
      expect(code).toMatch(/^[A-Z2-9]{8}$/);
      expect(await setReferrer(stranger, code!)).toEqual({ ok: true, referrer: admin });
      expect((await readProfile(stranger)).access).toBe(true);
    } finally {
      delete process.env.ANGLER_ADMINS;
    }
  });

  it("gives traders no codes while closed and accepts only admins' codes; opening it lets everyone in", async () => {
    const admin = "0x00000000000000000000000000000000000000ae";
    const trader = "0x0000000000000000000000000000000000000c33";
    const newcomer = "0x0000000000000000000000000000000000000d44";
    process.env.ANGLER_ADMINS = admin;
    try {
      // A code the trader earned while the beta was open...
      await setClosedBeta(false);
      await creditVolume(trader, "hyperliquid", 10_000);
      const [earned] = (await readProfile(trader, { owner: true })).invites!.codes;
      // ...waits while it's closed: none shown, none minted, and it doesn't let anyone in.
      await setClosedBeta(true);
      await creditVolume(trader, "hyperliquid", 20_000);
      expect((await readProfile(trader, { owner: true })).invites).toMatchObject({ codes: [], paused: true });
      expect(await setReferrer(newcomer, earned.code)).toMatchObject({ ok: false });
      expect((await readProfile(newcomer)).access).toBe(false);
      // Admins still mint at will, volume or not.
      expect((await readProfile(admin, { owner: true })).invites).toMatchObject({ paused: false });

      await setClosedBeta(false);
      expect(await readProfile(newcomer)).toMatchObject({ access: true, closedBeta: false });
      expect((await readProfile(trader, { owner: true })).invites!.codes).toHaveLength(3);
    } finally {
      await setClosedBeta(true);
      delete process.env.ANGLER_ADMINS;
    }
  });
});
