import { NextResponse, type NextRequest } from "next/server";
import { allowEvent } from "@/lib/analytics/store";
import { profileIdOf } from "@/lib/profile/identity";
import { extendedAccountOf } from "@/lib/profile/extended-volume";
import { linkExtendedAccount } from "@/lib/profile/store";
import { clientIp, sameOrigin } from "@/lib/same-origin";

/**
 * Links the caller's Extended account to an EVM profile, so its builder trades count there. Body `{ id }` (the wallet),
 * header `x-extended-api-key`: the account's own API key, which proves the account and is used for one read
 * (`/user/account/info`), never stored or logged. Only that key's holder can link the account, so no session is needed.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await allowEvent(clientIp(request)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const profile = typeof body?.id === "string" ? profileIdOf(body.id) : null;
  const apiKey = request.headers.get("x-extended-api-key")?.trim() ?? "";
  if (!profile || profile.chain !== "evm" || !/^[A-Za-z0-9_-]{8,200}$/.test(apiKey)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    const accountId = await extendedAccountOf(apiKey);
    if (!accountId) return NextResponse.json({ error: "Extended didn't accept that key." }, { status: 401 });
    const result = await linkExtendedAccount(profile.id, accountId);
    return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: 409 });
  } catch (error) {
    return NextResponse.json({ error: `Couldn't reach Extended: ${error instanceof Error ? error.message : String(error)}` }, { status: 502 });
  }
}
