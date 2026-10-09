import { NextResponse, type NextRequest } from "next/server";
import { discordConfig, discordUserFromCode } from "@/lib/discord/server";
import { linkDiscord, takeDiscordState } from "@/lib/profile/store";
import { rateLimited } from "@/lib/rate-limit";

const back = (request: NextRequest, result: string) => NextResponse.redirect(new URL(`/profile?discord=${result}#discord`, request.url));

/**
 * Discord's redirect after consent. The one-time `state` names the profile (made by `/api/discord/link` for a signed-in
 * owner), so this needs no cookie; the code is exchanged once for the account's id and name, and the token dropped.
 */
export async function GET(request: NextRequest) {
  const limited = rateLimited(request, "discord-callback", "send");
  if (limited) return limited;
  const config = discordConfig();
  if (!config) return back(request, "off");
  const params = request.nextUrl.searchParams;
  const id = await takeDiscordState(params.get("state") ?? "");
  if (!id) return back(request, "expired");
  const code = params.get("code");
  if (!code) return back(request, "cancelled");
  try {
    const user = await discordUserFromCode(config, code);
    const linked = await linkDiscord(id, user.id, user.name);
    return back(request, linked.ok ? "linked" : "taken");
  } catch {
    return back(request, "failed");
  }
}
