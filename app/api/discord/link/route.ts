import { NextResponse, type NextRequest } from "next/server";
import { discordAuthorizeUrl, managedRoles } from "@/lib/discord/roles";
import { clearDiscordRoles, discordConfig, discordRedirectUri } from "@/lib/discord/server";
import { SESSION_COOKIE, sessionId } from "@/lib/profile/session";
import { createDiscordState, unlinkDiscord } from "@/lib/profile/store";
import { sameOrigin } from "@/lib/same-origin";

const back = (request: NextRequest, result: string) => NextResponse.redirect(new URL(`/profile?discord=${result}#discord`, request.url));

/** Opened by "Connect Discord": sends the signed-in profile to Discord's consent page (identify only). */
export async function GET(request: NextRequest) {
  const config = discordConfig();
  if (!config) return back(request, "off");
  const id = await sessionId(request.cookies.get(SESSION_COOKIE)?.value);
  if (!id) return back(request, "signin");
  return NextResponse.redirect(discordAuthorizeUrl(config, discordRedirectUri(), await createDiscordState(id)));
}

/** Unlinks the profile's Discord account and takes back the roles this feature gave (best effort). */
export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = await sessionId(request.cookies.get(SESSION_COOKIE)?.value);
  if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const discordId = await unlinkDiscord(id);
  const config = discordConfig();
  if (discordId && config) await clearDiscordRoles(config, discordId, managedRoles(config));
  return NextResponse.json({ ok: true });
}
