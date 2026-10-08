import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionId } from "@/lib/profile/session";
import { createAdminInvite } from "@/lib/profile/store";
import { sameOrigin } from "@/lib/same-origin";

/** Creates an invite code for the signed-in admin (closed beta). Answers `{ code }`. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = await sessionId(request.cookies.get(SESSION_COOKIE)?.value);
  if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const code = await createAdminInvite(id);
  return code ? NextResponse.json({ code }) : NextResponse.json({ error: "Only admins can create invites." }, { status: 403 });
}
