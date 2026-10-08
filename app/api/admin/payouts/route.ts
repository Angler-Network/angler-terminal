import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/profile/admin";
import { profileIdOf } from "@/lib/profile/identity";
import { SESSION_COOKIE, sessionId } from "@/lib/profile/session";
import { readPayables, readPayouts, recordPayout } from "@/lib/profile/store";
import { sameOrigin } from "@/lib/same-origin";

async function adminOf(request: NextRequest) {
  const id = await sessionId(request.cookies.get(SESSION_COOKIE)?.value);
  if (!id) return { error: NextResponse.json({ error: "Sign in first." }, { status: 401 }) };
  if (!isAdmin(id)) return { error: NextResponse.json({ error: "Admins only." }, { status: 403 }) };
  return { id };
}

/** Referral payouts for admins: who is owed what (GET), or one profile's payout history (`?profile=`). */
export async function GET(request: NextRequest) {
  const admin = await adminOf(request);
  if ("error" in admin) return admin.error;
  const profile = profileIdOf(request.nextUrl.searchParams.get("profile") ?? "")?.id;
  const body = profile ? { payouts: await readPayouts(profile) } : { payables: await readPayables() };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}

/** Records a payout an admin sent: `{ profile, usd, reference }` (reference: transfer hash or a note). */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const admin = await adminOf(request);
  if ("error" in admin) return admin.error;
  const body = (await request.json().catch(() => null)) as { profile?: unknown; usd?: unknown; reference?: unknown } | null;
  const profile = typeof body?.profile === "string" ? profileIdOf(body.profile)?.id : undefined;
  const usd = Number(body?.usd);
  if (!profile || !Number.isFinite(usd)) return NextResponse.json({ error: "Invalid payout." }, { status: 400 });
  const result = await recordPayout(profile, usd, typeof body?.reference === "string" ? body.reference : "", admin.id);
  return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: 409 });
}
