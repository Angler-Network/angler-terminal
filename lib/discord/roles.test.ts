import { describe, expect, it } from "vitest";
import { desiredRoles, discordAuthorizeUrl, discordName, managedRoles, readDiscordConfig, roleChanges, rolesKey } from "./roles";

const ID = (n: number) => `1${String(n).padStart(18, "0")}`;
const base = { DISCORD_CLIENT_ID: ID(1), DISCORD_CLIENT_SECRET: "secret", DISCORD_BOT_TOKEN: "bot", DISCORD_GUILD_ID: ID(2) };

describe("readDiscordConfig", () => {
  it("reads level roles by name or number and VIP roles by tier", () => {
    const config = readDiscordConfig({ ...base, DISCORD_LEVEL_ROLES: `Minnow=${ID(10)}, perch:${ID(11)},3=${ID(12)}`, DISCORD_VIP_ROLES: `1=${ID(20)},VIP4=${ID(24)}` })!;
    expect([...config.levelRoles]).toEqual([
      [1, ID(10)],
      [2, ID(11)],
      [3, ID(12)],
    ]);
    expect([...config.vipRoles]).toEqual([
      [1, ID(20)],
      [4, ID(24)],
    ]);
  });

  it("skips bad pairs and is off without credentials or roles", () => {
    expect(readDiscordConfig({ ...base, DISCORD_LEVEL_ROLES: `Kraken=${ID(1)},11=${ID(2)},2=notanid` })).toBeNull();
    expect(readDiscordConfig({ ...base, DISCORD_BOT_TOKEN: "", DISCORD_VIP_ROLES: `1=${ID(20)}` })).toBeNull();
    expect(readDiscordConfig({ ...base, DISCORD_GUILD_ID: "abc", DISCORD_VIP_ROLES: `1=${ID(20)}` })).toBeNull();
    expect(readDiscordConfig({ ...base, DISCORD_VIP_ROLES: `0=${ID(20)},5=${ID(21)}` })).toBeNull();
  });

  it("is off on the testnet site", () => {
    const roles = { ...base, DISCORD_VIP_ROLES: `1=${ID(20)}` };
    expect(readDiscordConfig({ ...roles, NEXT_PUBLIC_DEPLOYMENT: "testnet" })).toBeNull();
    expect(readDiscordConfig({ ...roles, NEXT_PUBLIC_DEPLOYMENT: "mainnet" })).not.toBeNull();
  });
});

describe("roles to give", () => {
  const config = readDiscordConfig({ ...base, DISCORD_LEVEL_ROLES: `1=${ID(10)},2=${ID(11)},3=${ID(12)}`, DISCORD_VIP_ROLES: `1=${ID(20)},2=${ID(21)}` })!;

  it("is the current level's role and the VIP tier's, none for VIP 0 or an unmapped level", () => {
    expect(desiredRoles(config, { level: 2, vip: 1 })).toEqual([ID(11), ID(20)]);
    expect(desiredRoles(config, { level: 1, vip: 0 })).toEqual([ID(10)]);
    expect(desiredRoles(config, { level: 7, vip: 3 })).toEqual([]);
  });

  it("adds what's missing and takes back only managed roles moved past", () => {
    const managed = managedRoles(config);
    const other = ID(99);
    const changes = roleChanges([ID(10), ID(20), other], managed, desiredRoles(config, { level: 3, vip: 2 }));
    expect(changes).toEqual({ add: [ID(12), ID(21)], remove: [ID(10), ID(20)] });
    expect(roleChanges([ID(12), other], managed, [ID(12)])).toEqual({ add: [], remove: [] });
  });
});

describe("Discord helpers", () => {
  it("asks for identify only, with our state", () => {
    const url = new URL(discordAuthorizeUrl({ clientId: ID(1) }, "https://trade.angler.network/api/discord/callback", "abc"));
    expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: ID(1), scope: "identify", state: "abc", response_type: "code" });
  });

  it("shows the display name, else the username", () => {
    expect(discordName({ username: "fisher", global_name: "Big Fisher" })).toBe("Big Fisher");
    expect(discordName({ username: "fisher", global_name: null })).toBe("fisher");
  });
});

describe("rolesKey", () => {
  it("is the same for the same roles in any order", () => {
    expect(rolesKey([ID(12), ID(10)])).toBe(rolesKey([ID(10), ID(12)]));
    expect(rolesKey([])).toBe("");
  });
});
