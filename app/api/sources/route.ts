import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { anglerConfig, anglerOffResponse } from "@/lib/angler/env";
import { readSources } from "@/lib/angler/map";
import type { ApiSource } from "@/lib/angler/types";

const TIMEOUT_MS = 10_000;

const listSources = unstable_cache(
  async (apiUrl: string): Promise<ApiSource[]> => {
    const { key } = anglerConfig();
    const response = await fetch(`${apiUrl}/v1/sources`, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Angler API responded ${response.status}`);
    return readSources(await response.json());
  },
  ["angler-sources-v1"],
  { revalidate: 600 },
);

/**
 * Proxies GET /v1/sources (cached 10 min). News names its source by `source_id` on REST and by slug
 * (`external_id`) on the socket; the feed resolves both to the source title with this list.
 */
export async function GET() {
  const { apiUrl, key } = anglerConfig();
  if (!key) return anglerOffResponse();
  try {
    const items = await listSources(apiUrl);
    return NextResponse.json({ items }, { headers: { "cache-control": "public, max-age=300, s-maxage=600" } });
  } catch {
    return NextResponse.json({ error: "Angler API is unreachable" }, { status: 502 });
  }
}
