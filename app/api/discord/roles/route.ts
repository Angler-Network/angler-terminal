import { NextResponse, type NextRequest } from "next/server";
import { desiredRoles, managedRoles } from "@/lib/discord/roles";
import { discordConfig, syncDiscordRoles } from "@/lib/discord/server";
import { SESSION_COOKIE, sessionId } from "@/lib/profile/session";
import { readDiscordLink, readProfile, takeDiscordClaim, volume30d } from "@/lib/profile/store";
import { vipFor } from "@/lib/profile/vip";
import { sameOrigin } from "@/lib/same-origin";

/**
 * "Claim roles": the bot gives the linked Discord account the roles of the profile's level and 30-day VIP tier now and
 * takes back the ones it moved past. Only on this request (opt-in); nothing changes roles on its own.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const config = discordConfig();
  if (!config) return NextResponse.json({ error: "Discord roles aren't set up on this site yet." }, { status: 503 });
  const id = await sessionId(request.cookies.get(SESSION_COOKIE)?.value);
  if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const link = await readDiscordLink(id);
  if (!link) return NextResponse.json({ error: "Connect your Discord account first." }, { status: 400 });
  if (!(await takeDiscordClaim(id))) return NextResponse.json({ error: "Roles were just updated. Try again in a few seconds." }, { status: 429 });
  const [profile, volume] = await Promise.all([readProfile(id), volume30d(id)]);
  const standing = { level: profile.level.level, vip: vipFor(volume).level };
  const result = await syncDiscordRoles(config, link.id, desiredRoles(config, standing), managedRoles(config));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ level: profile.level.name, vip: standing.vip, added: result.added.length, removed: result.removed.length });
}
