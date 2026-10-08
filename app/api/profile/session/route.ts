import { NextResponse, type NextRequest } from "next/server";
import { allowEvent } from "@/lib/analytics/store";
import { verifyProfileMessage } from "@/lib/profile/server";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, createSession } from "@/lib/profile/session";
import { clientIp, sameOrigin } from "@/lib/same-origin";

/** Signs the wallet in for 30 days. Body: `{ message, signature }` from `profileMessage({ kind: "session" })`. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await allowEvent(clientIp(request)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const body = (await request.json().catch(() => null)) as { message?: unknown; signature?: unknown } | null;
  if (typeof body?.message !== "string" || typeof body.signature !== "string") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const verified = await verifyProfileMessage(body.message, body.signature);
  if ("error" in verified) return NextResponse.json({ error: verified.error }, { status: 401 });
  if (verified.action.kind !== "session") return NextResponse.json({ error: "Wrong action." }, { status: 400 });
  const response = NextResponse.json({ id: verified.id });
  response.cookies.set(SESSION_COOKIE, await createSession(verified.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
