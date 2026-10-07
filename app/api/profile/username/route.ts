import { NextResponse, type NextRequest } from "next/server";
import { allowEvent } from "@/lib/analytics/store";
import { usernameError } from "@/lib/profile/identity";
import { verifyProfileMessage } from "@/lib/profile/server";
import { setUsername } from "@/lib/profile/store";
import { clientIp, sameOrigin } from "@/lib/same-origin";

/** Sets the signing wallet's username. Body: `{ message, signature }` from `profileMessage({ kind: "username" })`. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await allowEvent(clientIp(request)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const body = (await request.json().catch(() => null)) as { message?: unknown; signature?: unknown } | null;
  if (typeof body?.message !== "string" || typeof body.signature !== "string") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const verified = await verifyProfileMessage(body.message, body.signature);
  if ("error" in verified) return NextResponse.json({ error: verified.error }, { status: 401 });
  if (verified.action.kind !== "username") return NextResponse.json({ error: "Wrong action." }, { status: 400 });
  const invalid = usernameError(verified.action.username);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const result = await setUsername(verified.id, verified.action.username);
  return result.ok ? NextResponse.json({ username: verified.action.username }) : NextResponse.json({ error: result.error }, { status: 409 });
}
