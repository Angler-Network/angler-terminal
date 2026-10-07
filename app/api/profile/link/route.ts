import { NextResponse, type NextRequest } from "next/server";
import { allowEvent } from "@/lib/analytics/store";
import { profileIdOf } from "@/lib/profile/identity";
import { verifyProfileMessage } from "@/lib/profile/server";
import { linkWallet } from "@/lib/profile/store";
import { clientIp, sameOrigin } from "@/lib/same-origin";

/**
 * Links a Solana wallet to an EVM profile so its swaps count there. Body: `{ message, signature }`, signed by the
 * Solana wallet (`profileMessage({ kind: "link", profile })`).
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await allowEvent(clientIp(request)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const body = (await request.json().catch(() => null)) as { message?: unknown; signature?: unknown } | null;
  if (typeof body?.message !== "string" || typeof body.signature !== "string") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const verified = await verifyProfileMessage(body.message, body.signature);
  if ("error" in verified) return NextResponse.json({ error: verified.error }, { status: 401 });
  if (verified.action.kind !== "link") return NextResponse.json({ error: "Wrong action." }, { status: 400 });
  const target = profileIdOf(verified.action.profile);
  if (profileIdOf(verified.id)?.chain !== "solana" || target?.chain !== "evm") {
    return NextResponse.json({ error: "Link a Solana wallet to an EVM profile." }, { status: 400 });
  }
  await linkWallet(verified.id, target.id);
  return NextResponse.json({ linked: verified.id, profile: target.id });
}
