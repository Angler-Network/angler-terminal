import { NextResponse, type NextRequest } from "next/server";
import { anglerConfig, anglerDown, anglerOffResponse, markAnglerDown } from "@/lib/angler/env";
import { readApiNewsPage } from "@/lib/angler/map";
import { rateLimited } from "@/lib/rate-limit";

const TIMEOUT_MS = 10_000;
const MAX_LIMIT = 100;
const COIN_PATTERN = /^[A-Za-z0-9:]{1,30}$/;
// Every open tab without a live socket polls the same first page every 15s: one upstream call per few seconds serves them all.
const FRESH_MS = 5_000;
const MAX_ENTRIES = 200;
const pages = new Map<string, { at: number; body: Promise<unknown> }>();

/** One upstream call per query and FRESH_MS (per instance); concurrent requests share the call in flight. */
function cachedPage(query: string, load: () => Promise<unknown>) {
  const now = Date.now();
  const hit = pages.get(query);
  if (hit && now - hit.at < FRESH_MS) return hit.body;
  const body = load();
  pages.set(query, { at: now, body });
  body.catch(() => pages.delete(query));
  if (pages.size > MAX_ENTRIES) pages.delete(pages.keys().next().value!);
  return body;
}

class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(`Angler API responded ${status}`);
  }
}

/**
 * Proxies GET /v1/news so the API key stays on the server. Query: coin, min_importance, limit, cursor.
 * Answers a validated `ApiNewsPage` without `content` (article bodies run to ~250 KB each).
 */
export async function GET(request: NextRequest) {
  const limited = rateLimited(request, "news");
  if (limited) return limited;
  const { apiUrl, key } = anglerConfig();
  if (!key) return anglerOffResponse();

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

  if (anglerDown()) return NextResponse.json({ error: "Angler API is unreachable" }, { status: 502 });
  try {
    const query = params.toString();
    const page = await cachedPage(query, async () => {
      const response = await fetch(`${apiUrl}/v1/news?${query}`, {
        headers: { authorization: `Bearer ${key}`, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new UpstreamError(response.status);
      return readApiNewsPage(await response.json());
    });
    // The CDN shares it across instances too: the first page for a few seconds, older pages (a cursor) for a minute.
    const cacheControl = cursor ? "public, s-maxage=60, stale-while-revalidate=60" : "public, s-maxage=5, stale-while-revalidate=10";
    return NextResponse.json(page, { headers: { "cache-control": cacheControl } });
  } catch (caught) {
    markAnglerDown();
    if (caught instanceof UpstreamError) return NextResponse.json({ error: `Angler API responded ${caught.status}` }, { status: 502 });
    return NextResponse.json({ error: "Angler API is unreachable" }, { status: 502 });
  }
}
