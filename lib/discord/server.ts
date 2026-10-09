import "server-only";
import { siteUrl } from "@/lib/site";
import { discordName, readDiscordConfig, roleChanges, type DiscordConfig } from "./roles";

/**
 * Discord REST calls for the role feature (`roles.ts`): the OAuth code exchange (user token, `identify`) and the bot's
 * member reads and role changes in our server. No gateway connection: every call is a plain request from a route, so
 * it runs on Vercel like everything else.
 */

const API = "https://discord.com/api/v10";
const TIMEOUT_MS = 10_000;

export const discordConfig = () => readDiscordConfig(process.env);
export const discordRedirectUri = () => `${siteUrl()}/api/discord/callback`;

export class DiscordError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

async function call(path: string, init: RequestInit & { bot?: string; bearer?: string }) {
  const headers = new Headers(init.headers);
  if (init.bot) headers.set("authorization", `Bot ${init.bot}`);
  if (init.bearer) headers.set("authorization", `Bearer ${init.bearer}`);
  const response = await fetch(`${API}${path}`, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status === 204) return null;
  const body = (await response.json().catch(() => ({}))) as { code?: number; message?: string } & Record<string, unknown>;
  if (!response.ok) throw new DiscordError(body.message ?? `Discord answered ${response.status}`, body.code);
  return body;
}

/** The Discord account behind an OAuth code (its token is used once and dropped). */
export async function discordUserFromCode(config: DiscordConfig, code: string) {
  const token = (await call("/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: discordRedirectUri(), client_id: config.clientId, client_secret: config.clientSecret }),
  })) as { access_token?: unknown };
  if (typeof token.access_token !== "string") throw new DiscordError("Discord didn't confirm the account.");
  const user = (await call("/users/@me", { bearer: token.access_token })) as { id?: unknown; username?: unknown; global_name?: unknown };
  if (typeof user.id !== "string" || !/^\d{17,20}$/.test(user.id)) throw new DiscordError("Discord didn't say who you are.");
  return { id: user.id, name: discordName(user) };
}

/** Readable reasons for the errors a role claim can hit. */
function roleError(error: unknown) {
  if (error instanceof DiscordError) {
    if (error.code === 10007) return "Join our Discord server first, then claim your roles.";
    if (error.code === 50013) return "The bot can't give these roles yet (it needs Manage Roles and a higher role). The team has been told.";
    if (error.code === 10011) return "A configured role no longer exists on the server.";
  }
  return "Discord didn't answer. Try again in a minute.";
}

/**
 * Brings a member's managed roles in line with `desired` (adds what's missing, takes back what they moved past).
 * Answers what changed, or a readable error.
 */
export async function syncDiscordRoles(config: DiscordConfig, userId: string, desired: string[], managed: Set<string>) {
  try {
    const member = (await call(`/guilds/${config.guildId}/members/${userId}`, { bot: config.botToken })) as { roles?: unknown };
    const current = Array.isArray(member.roles) ? member.roles.filter((role): role is string => typeof role === "string") : [];
    const { add, remove } = roleChanges(current, managed, desired);
    const reason = { "x-audit-log-reason": "Angler level / VIP roles" };
    for (const role of add) await call(`/guilds/${config.guildId}/members/${userId}/roles/${role}`, { method: "PUT", bot: config.botToken, headers: reason });
    for (const role of remove) await call(`/guilds/${config.guildId}/members/${userId}/roles/${role}`, { method: "DELETE", bot: config.botToken, headers: reason });
    return { ok: true as const, added: add, removed: remove };
  } catch (error) {
    if (error instanceof DiscordError && error.code === 50013) console.warn("[discord] the bot lacks permission to manage the configured roles");
    return { ok: false as const, error: roleError(error) };
  }
}

/** Takes back every managed role (unlinking); best effort. */
export async function clearDiscordRoles(config: DiscordConfig, userId: string, managed: Set<string>) {
  return syncDiscordRoles(config, userId, [], managed);
}
