import { NextResponse, type NextRequest } from "next/server";
import { anglerConfig, missingKeyResponse } from "@/lib/angler/env";
import type { WsTicketResponse } from "@/lib/angler/types";
import { rateLimited } from "@/lib/rate-limit";

const TIMEOUT_MS = 10_000;

/**
 * Mints a single-use realtime ticket. A ticket opens exactly one socket, so the browser calls this on every
 * connect and reconnect and passes the ticket as connection data.
 */
export async function POST(request: NextRequest) {
  const limited = rateLimited(request, "ws-ticket");
  if (limited) return limited;
  const { apiUrl, wsUrl, key } = anglerConfig();
  if (!key) return NextResponse.json(missingKeyResponse, { status: 503 });

  try {
    const response = await fetch(`${apiUrl}/v1/ws/ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return NextResponse.json({ error: `Angler API responded ${response.status}` }, { status: 502 });
    }
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.ticket !== "string" || !body.ticket) {
      return NextResponse.json({ error: "Angler API returned no ticket" }, { status: 502 });
    }
    const ticket: WsTicketResponse = {
      ticket: body.ticket,
      expires_in: Number(body.expires_in) || 0,
      channels: Array.isArray(body.channels) ? body.channels.filter((channel): channel is string => typeof channel === "string") : [],
      url: wsUrl,
    };
    return NextResponse.json(ticket, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Angler API is unreachable" }, { status: 502 });
  }
}
