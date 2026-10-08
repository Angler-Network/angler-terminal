import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { creditVolume, readProfile, setReferrer } = await import("./store");

describe("invites", () => {
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
});
