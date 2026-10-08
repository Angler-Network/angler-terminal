import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { creditVolume, readProfile, setReferrer } = await import("./store");

describe("invites", () => {
  it("earns one single-use code per $10K and only lets new profiles join with one", async () => {
    const inviter = "0x00000000000000000000000000000000000000a1";
    const newcomer = "0x00000000000000000000000000000000000000b2";
    const second = "0x00000000000000000000000000000000000000c3";
    const trader = "0x00000000000000000000000000000000000000d4";

    expect((await readProfile(inviter)).invites.codes).toEqual([]);
    await creditVolume(inviter, "hyperliquid", 25_000);
    const { codes, nextAt } = (await readProfile(inviter)).invites;
    expect(codes).toHaveLength(2);
    expect(nextAt).toBe(30_000);
    // Reading again doesn't mint more.
    expect((await readProfile(inviter)).invites.codes.map((entry) => entry.code)).toEqual(codes.map((entry) => entry.code));

    const [first] = codes;
    expect(await setReferrer(inviter, first.code)).toMatchObject({ ok: false });
    expect(await setReferrer(newcomer, "NOTACODE")).toMatchObject({ ok: false });
    expect(await setReferrer(newcomer, first.code.toLowerCase())).toEqual({ ok: true, referrer: inviter });
    expect(await setReferrer(second, first.code)).toMatchObject({ ok: false, error: "That invite was already used." });

    await creditVolume(trader, "lighter", 50);
    expect(await setReferrer(trader, codes[1].code)).toMatchObject({ ok: false, error: "Invites only apply to new profiles." });

    const after = await readProfile(inviter);
    expect(after.referrals).toBe(1);
    expect(after.invites.codes.find((entry) => entry.code === first.code)?.usedBy).toBe(newcomer);
  });
});
