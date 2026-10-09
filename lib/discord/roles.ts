import { LEVELS } from "@/lib/profile/levels";

/**
 * Discord roles for levels and VIP tiers (pure, unit-tested; the calls are in `server.ts`). Optional: a trader links
 * their Discord account from the profile (OAuth, `identify` only) and presses "Claim roles"; the bot then gives the role
 * of their current level and VIP tier and takes back the ones they've moved past. One role per group at a time, and
 * roles this feature doesn't manage are never touched.
 *
 * Env (all server side; the feature is off unless every required one is set):
 * - DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET: the Discord application (OAuth2 → redirect `<site>/api/discord/callback`).
 * - DISCORD_BOT_TOKEN: the same application's bot, in the server, with Manage Roles and its role above the ones below.
 * - DISCORD_GUILD_ID: the server.
 * - DISCORD_LEVEL_ROLES: `Minnow=<role id>,Perch=<role id>,…` (level names or numbers 1-10), any subset.
 * - DISCORD_VIP_ROLES: `1=<role id>,2=<role id>,…` (VIP tiers 1-4; VIP 0 has none), any subset.
 * Never on the testnet site (`NEXT_PUBLIC_DEPLOYMENT=testnet`): levels earned with test funds earn no roles.
 */

export interface DiscordConfig {
  clientId: string;
  clientSecret: string;
  botToken: string;
  guildId: string;
  /** Level number (1-based) → role id. */
  levelRoles: Map<number, string>;
  /** VIP tier (1-4) → role id. */
  vipRoles: Map<number, string>;
}

const SNOWFLAKE = /^\d{17,20}$/;

/** `key=id` (or `key:id`) pairs, comma separated; keys mapped by `keyOf`, bad pairs skipped. */
function readRoleList(value: string | undefined, keyOf: (key: string) => number | null) {
  const roles = new Map<number, string>();
  for (const pair of (value ?? "").split(",")) {
    const [rawKey, rawId] = pair.split(/[=:]/).map((part) => part?.trim() ?? "");
    const key = rawKey ? keyOf(rawKey) : null;
    if (key !== null && SNOWFLAKE.test(rawId ?? "")) roles.set(key, rawId!);
  }
  return roles;
}

const levelKey = (key: string) => {
  const number = Number(key);
  if (Number.isInteger(number) && number >= 1 && number <= LEVELS.length) return number;
  const index = LEVELS.findIndex((level) => level.name.toLowerCase() === key.toLowerCase());
  return index >= 0 ? index + 1 : null;
};

const vipKey = (key: string) => {
  const number = Number(key.replace(/^vip\s*/i, ""));
  return Number.isInteger(number) && number >= 1 && number <= 4 ? number : null;
};

/** The feature's settings, or null when it isn't set up (any credential missing, or no role to give) or on testnet. */
export function readDiscordConfig(env: Record<string, string | undefined>): DiscordConfig | null {
  if (env.NEXT_PUBLIC_DEPLOYMENT?.trim().toLowerCase() === "testnet") return null;
  const clientId = env.DISCORD_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.DISCORD_CLIENT_SECRET?.trim() ?? "";
  const botToken = env.DISCORD_BOT_TOKEN?.trim() ?? "";
  const guildId = env.DISCORD_GUILD_ID?.trim() ?? "";
  if (!SNOWFLAKE.test(clientId) || !clientSecret || !botToken || !SNOWFLAKE.test(guildId)) return null;
  const levelRoles = readRoleList(env.DISCORD_LEVEL_ROLES, levelKey);
  const vipRoles = readRoleList(env.DISCORD_VIP_ROLES, vipKey);
  if (levelRoles.size === 0 && vipRoles.size === 0) return null;
  return { clientId, clientSecret, botToken, guildId, levelRoles, vipRoles };
}

/** Every role id this feature gives or takes back. */
export function managedRoles(config: Pick<DiscordConfig, "levelRoles" | "vipRoles">) {
  return new Set([...config.levelRoles.values(), ...config.vipRoles.values()]);
}

/** The roles a profile should hold: its level's and its VIP tier's (each only if configured). */
export function desiredRoles(config: Pick<DiscordConfig, "levelRoles" | "vipRoles">, standing: { level: number; vip: number }) {
  const roles: string[] = [];
  const level = config.levelRoles.get(standing.level);
  if (level) roles.push(level);
  const vip = standing.vip > 0 ? config.vipRoles.get(standing.vip) : undefined;
  if (vip) roles.push(vip);
  return roles;
}

/** What to add and take back, given the member's roles now: only managed roles ever move. */
export function roleChanges(current: string[], managed: Set<string>, desired: string[]) {
  const held = new Set(current);
  const wanted = new Set(desired);
  return {
    add: desired.filter((role) => !held.has(role)),
    remove: current.filter((role) => managed.has(role) && !wanted.has(role)),
  };
}

/** Discord's consent page: `identify` only (no email, no servers list), back to our callback with the state. */
export function discordAuthorizeUrl(config: Pick<DiscordConfig, "clientId">, redirectUri: string, state: string) {
  const params = new URLSearchParams({ client_id: config.clientId, response_type: "code", redirect_uri: redirectUri, scope: "identify", state, prompt: "none" });
  return `https://discord.com/oauth2/authorize?${params}`;
}

/** How a Discord account is shown: its display name, else its username. */
export function discordName(user: { username?: unknown; global_name?: unknown }) {
  if (typeof user.global_name === "string" && user.global_name.trim()) return user.global_name.trim();
  return typeof user.username === "string" ? user.username : "Discord user";
}
