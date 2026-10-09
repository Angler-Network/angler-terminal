import { NextResponse, type NextRequest } from "next/server";
import { readClosedBeta, setClosedBeta } from "@/lib/ops/beta";
import { isAdmin } from "@/lib/profile/admin";
import { SESSION_COOKIE, sessionId } from "@/lib/profile/session";
import { sameOrigin } from "@/lib/same-origin";

/** Turns the closed beta on or off for everyone. Body `{ closed: boolean }`; signed-in admins only. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = await sessionId(request.cookies.get(SESSION_COOKIE)?.value);
  if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isAdmin(id)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { closed?: unknown } | null;
  if (typeof body?.closed !== "boolean") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  await setClosedBeta(body.closed);
  return NextResponse.json({ closedBeta: await readClosedBeta() });
}
