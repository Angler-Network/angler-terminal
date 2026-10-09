import { NextResponse, type NextRequest } from "next/server";
import { allowEvent } from "@/lib/analytics/store";
import { claimBridge } from "@/lib/profile/bridge-points-server";
import { clientIp, sameOrigin } from "@/lib/same-origin";

const ID = /^(?:0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,90})$/;

/**
 * Credits a finished Relay request (`id` = request id) or LI.FI transfer (`id` = origin transaction hash, EVM or
 * Solana) to the sender's profile. Body: `{ provider, id }`. The server reads the bridge's own record and counts it
 * once when it carried our fee.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await allowEvent(clientIp(request)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const body = (await request.json().catch(() => null)) as { provider?: unknown; id?: unknown } | null;
  const provider = body?.provider === "relay" || body?.provider === "lifi" ? body.provider : null;
  if (!provider || typeof body?.id !== "string" || !ID.test(body.id) || (provider === "relay" && !body.id.startsWith("0x"))) {
    return NextResponse.json({ error: "Invalid route." }, { status: 400 });
  }
  try {
    const result = await claimBridge(provider, body.id);
    return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (error) {
    return NextResponse.json({ error: `Couldn't check the route: ${error instanceof Error ? error.message : String(error)}` }, { status: 502 });
  }
}
