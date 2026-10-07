import { NextResponse, type NextRequest } from "next/server";
import { allowEvent } from "@/lib/analytics/store";
import { claimSwap } from "@/lib/profile/server";
import { clientIp, sameOrigin } from "@/lib/same-origin";

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/**
 * Credits a finished Solana swap to its signer's profile. Body: `{ signature }`. The server reads the transaction
 * itself and only counts it when it paid our Jupiter referral or Titan fee, once per transaction.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await allowEvent(clientIp(request)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const body = (await request.json().catch(() => null)) as { signature?: unknown } | null;
  if (typeof body?.signature !== "string" || !SIGNATURE.test(body.signature)) return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  try {
    const result = await claimSwap(body.signature);
    return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (error) {
    return NextResponse.json({ error: `Couldn't check the swap: ${error instanceof Error ? error.message : String(error)}` }, { status: 502 });
  }
}
