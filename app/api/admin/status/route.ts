import { NextResponse, type NextRequest } from "next/server";
import { isServiceId, readOffServices, setServiceOff } from "@/lib/ops/kill-switch";
import { isAdmin } from "@/lib/profile/admin";
import { SESSION_COOKIE, sessionId } from "@/lib/profile/session";
import { sameOrigin } from "@/lib/same-origin";

/** Turns a service off (or back on) for everyone. Body `{ id: "bridge:relay", off: true }`; signed-in admins only. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = await sessionId(request.cookies.get(SESSION_COOKIE)?.value);
  if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isAdmin(id)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { id?: unknown; off?: unknown } | null;
  if (!isServiceId(body?.id) || typeof body.off !== "boolean") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  await setServiceOff(body.id, body.off);
  return NextResponse.json({ off: await readOffServices() });
}
