import { NextResponse, type NextRequest } from "next/server";
import { sameOrigin } from "@/lib/same-origin";
import { readRelayServerConfig, relayFetch, withRelayFee } from "@/lib/venues/relay-server";

const MAX_BODY = 20_000;

async function relay(response: Response) {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text.slice(0, 300) || `Relay responded ${response.status}` };
  }
  return NextResponse.json(body, { status: response.status, headers: { "cache-control": "no-store" } });
}

const unreachable = () => NextResponse.json({ message: "Relay is unreachable right now." }, { status: 502 });

/** GET /api/relay/intents/status/v2?requestId= : a bridge leg's progress. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  const requestId = request.nextUrl.searchParams.get("requestId") ?? "";
  if (path !== "intents/status/v2" || !/^0x[0-9a-fA-F]{64}$/.test(requestId)) return NextResponse.json({ message: "Not found" }, { status: 404 });
  try {
    return await relay(await relayFetch(`/intents/status/v2?requestId=${requestId}`, readRelayServerConfig(process.env).apiKey));
  } catch {
    return unreachable();
  }
}

/** POST /api/relay/quote: a bridge leg's quote, with our app fee added here (never by the browser). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  if ((await params).path.join("/") !== "quote") return NextResponse.json({ message: "Not found" }, { status: 404 });
  if (!sameOrigin(request)) return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ message: "Request too large." }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ message: "Invalid body." }, { status: 400 });
  const config = readRelayServerConfig(process.env);
  try {
    return await relay(
      await relayFetch("/quote", config.apiKey, { method: "POST", body: JSON.stringify(withRelayFee(body, config)), headers: { "content-type": "application/json" } }),
    );
  } catch {
    return unreachable();
  }
}
