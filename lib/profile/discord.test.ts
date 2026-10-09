import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createDiscordState, linkDiscord, readDiscordLink, readProfile, takeDiscordClaim, takeDiscordState, unlinkDiscord } = await import("./store");

const alice = "0x00000000000000000000000000000000000d15c0";
const bob = "0x00000000000000000000000000000000000d15c1";
const discordA = "100000000000000001";
const discordB = "100000000000000002";

describe("Discord link", () => {
  it("spends an OAuth state once, for the profile it was made for", async () => {
    const state = await createDiscordState(alice);
    expect(await takeDiscordState(state)).toBe(alice);
    expect(await takeDiscordState(state)).toBeNull();
    expect(await takeDiscordState("short")).toBeNull();
  });

  it("links one profile per Discord account, relinks freely, and unlinks", async () => {
    expect(await linkDiscord(alice, discordA, "Alice")).toEqual({ ok: true });
    expect(await linkDiscord(bob, discordA, "Alice again")).toMatchObject({ ok: false });
    // Alice moves to another Discord account: the first one is free again.
    expect(await linkDiscord(alice, discordB, "Alice 2")).toEqual({ ok: true });
    expect(await linkDiscord(bob, discordA, "Bob")).toEqual({ ok: true });
    expect(await readDiscordLink(alice)).toEqual({ id: discordB, name: "Alice 2" });

    expect(await unlinkDiscord(alice)).toBe(discordB);
    expect(await readDiscordLink(alice)).toBeNull();
    expect(await unlinkDiscord(alice)).toBeNull();
  });

  it("names the linked account to its owner only", async () => {
    await linkDiscord(alice, discordB, "Alice 2");
    expect((await readProfile(alice, { owner: true })).discord.name).toBe("Alice 2");
    expect((await readProfile(alice)).discord.name).toBeNull();
  });

  it("lets a profile claim roles once per short while", async () => {
    expect(await takeDiscordClaim(bob)).toBe(true);
    expect(await takeDiscordClaim(bob)).toBe(false);
  });
});
