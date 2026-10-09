import "server-only";
import { discordLinkedIds, readDiscordStanding, saveDiscordSync, takeDiscordAuto } from "@/lib/profile/store";
import { vipFor } from "@/lib/profile/vip";
import { desiredRoles, managedRoles, rolesKey } from "./roles";
import { discordConfig, syncDiscordRoles } from "./server";

/**
 * Keeps linked members' level and VIP roles current without a press: run from the alerts tick, at most every
 * AUTO_SECONDS. Each linked profile's roles are worked out from its stored points and 30-day volume; only a profile
 * whose roles differ from the last sync costs Discord calls (MAX_SYNCS a run). A member who isn't in the server, or a
 * bot without the rights, is tried again after RETRY_MS.
 */

const MAX_SYNCS = 15;
const RETRY_MS = 6 * 3_600_000;

export async function refreshDiscordRoles(now = Date.now()) {
  const config = discordConfig();
  if (!config || !(await takeDiscordAuto())) return { skipped: true as const };
  const managed = managedRoles(config);
  let synced = 0;
  for (const id of await discordLinkedIds()) {
    if (synced >= MAX_SYNCS) break;
    const standing = await readDiscordStanding(id);
    if (!standing || standing.retryAt > now) continue;
    const desired = desiredRoles(config, { level: standing.level, vip: vipFor(standing.volume30d).level });
    const wanted = rolesKey(desired);
    if (wanted === standing.roles) continue;
    synced++;
    const result = await syncDiscordRoles(config, standing.discordId, desired, managed);
    await (result.ok ? saveDiscordSync(id, wanted) : saveDiscordSync(id, null, now + RETRY_MS));
  }
  return { skipped: false as const, synced };
}
