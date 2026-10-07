import { buildHmacSignature } from "@polymarket/client";
import { NextResponse, type NextRequest } from "next/server";
import { allowEvent } from "@/lib/analytics/store";
import { clientIp } from "@/lib/same-origin";
import { isSignableBuilderRequest } from "@/lib/venues/polymarket/config";

const MAX_BODY = 64_000;

/**
 * Remote builder signing for the Polymarket SDK (`remoteBuilderSigning`): the browser sends the method, path and
 * body of a request it's about to make; we return the builder headers so the key never leaves the server. Only our
 * own pages may ask (Origin must match), only order/cancel/relayer-style requests are signed, and each client is
 * rate limited. 503 without builder credentials.
 */
export async function POST(request: NextRequest) {
  const key = process.env.POLYMARKET_BUILDER_API_KEY?.trim();
  const secret = process.env.POLYMARKET_BUILDER_SECRET?.trim();
  const passphrase = process.env.POLYMARKET_BUILDER_PASSPHRASE?.trim();
  if (!key || !secret || !passphrase) return NextResponse.json({ error: "Polymarket trading isn't configured." }, { status: 503 });

  // Unlike other write routes, a missing Origin is refused too: this endpoint hands out signatures.
  const origin = request.headers.get("origin");
  try {
    if (!origin || new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await allowEvent(clientIp(request)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Request too large." }, { status: 413 });
  let input: { method?: unknown; path?: unknown; body?: unknown };
  try {
    input = JSON.parse(raw) as typeof input;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!isSignableBuilderRequest(input.method, input.path) || (input.body !== undefined && typeof input.body !== "string")) {
    return NextResponse.json({ error: "This request can't be signed." }, { status: 400 });
  }
  const timestamp = Math.floor(Date.now() / 1000);
  return NextResponse.json(
    {
      POLY_BUILDER_API_KEY: key,
      POLY_BUILDER_PASSPHRASE: passphrase,
      POLY_BUILDER_SIGNATURE: await buildHmacSignature(secret, timestamp, input.method as string, input.path as string, input.body as string | undefined),
      POLY_BUILDER_TIMESTAMP: `${timestamp}`,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
