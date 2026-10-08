import { NextResponse, type NextRequest } from "next/server";
import { anglerConfig, missingKeyResponse } from "@/lib/angler/env";
import { readApiNewsPage } from "@/lib/angler/map";
import { rateLimited } from "@/lib/rate-limit";

const TIMEOUT_MS = 10_000;
const MAX_LIMIT = 100;
const COIN_PATTERN = /^[A-Za-z0-9:]{1,30}$/;

/**
 * Proxies GET /v1/news so the API key stays on the server. Query: coin, min_importance, limit, cursor.
 * Answers a validated `ApiNewsPage` without `content` (article bodies run to ~250 KB each).
 */
export async function GET(request: NextRequest) {
  const limited = rateLimited(request, "news");
  if (limited) return limited;
  const { apiUrl, key } = anglerConfig();
  if (!key) return NextResponse.json(missingKeyResponse, { status: 503 });

  const incoming = request.nextUrl.searchParams;
  const params = new URLSearchParams();
  const coin = incoming.get("coin");
  if (coin && COIN_PATTERN.test(coin)) params.set("coin", coin.toUpperCase());
  const minImportance = Number(incoming.get("min_importance"));
  if (incoming.has("min_importance") && Number.isFinite(minImportance)) {
    params.set("min_importance", String(Math.min(100, Math.max(0, Math.round(minImportance)))));
  }
  const limit = Number(incoming.get("limit"));
  params.set("limit", String(Number.isFinite(limit) && limit > 0 ? Math.min(MAX_LIMIT, Math.round(limit)) : 50));
  const cursor = incoming.get("cursor");
  if (cursor) params.set("cursor", cursor.slice(0, 500));

  try {
    const response = await fetch(`${apiUrl}/v1/news?${params}`, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return NextResponse.json({ error: `Angler API responded ${response.status}` }, { status: 502 });
    }
    return NextResponse.json(readApiNewsPage(await response.json()), { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Angler API is unreachable" }, { status: 502 });
  }
}
