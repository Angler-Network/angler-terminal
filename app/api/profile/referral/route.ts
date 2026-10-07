import { NextResponse, type NextRequest } from "next/server";
import { allowEvent } from "@/lib/analytics/store";
import { REFERRAL_CODE } from "@/lib/profile/identity";
import { verifyProfileMessage } from "@/lib/profile/server";
import { setReferrer } from "@/lib/profile/store";
import { clientIp, sameOrigin } from "@/lib/same-origin";

/** Sets who referred the signing wallet (once). Body: `{ message, signature }` from `profileMessage({ kind: "referral" })`. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await allowEvent(clientIp(request)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const body = (await request.json().catch(() => null)) as { message?: unknown; signature?: unknown } | null;
  if (typeof body?.message !== "string" || typeof body.signature !== "string") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const verified = await verifyProfileMessage(body.message, body.signature);
  if ("error" in verified) return NextResponse.json({ error: verified.error }, { status: 401 });
  if (verified.action.kind !== "referral" || !REFERRAL_CODE.test(verified.action.code)) return NextResponse.json({ error: "Invalid referral code." }, { status: 400 });
  const result = await setReferrer(verified.id, verified.action.code);
  return result.ok ? NextResponse.json({ referrer: result.referrer }) : NextResponse.json({ error: result.error }, { status: 409 });
}
