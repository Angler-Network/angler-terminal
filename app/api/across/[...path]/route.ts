import { NextResponse, type NextRequest } from "next/server";
import { readAcrossServerConfig } from "@/lib/venues/across-server";
import { rateLimited } from "@/lib/rate-limit";

/** The two Across endpoints the funds window uses; nothing else is proxied. */
const UPSTREAM: Record<string, string> = {
  "swap/approval": "https://app.across.to/api/swap/approval",
  "deposit/status": "https://indexer.api.across.to/deposit/status",
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const limited = rateLimited(request, "across");
  if (limited) return limited;
  const upstream = UPSTREAM[(await params).path.join("/")];
  if (!upstream) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const query = new URLSearchParams(request.nextUrl.searchParams);
  if (upstream.endsWith("/swap/approval")) {
    // Attribution and our fee are the server's call, never the browser's.
    for (const key of ["integratorId", "appFee", "appFeeRecipient"]) query.delete(key);
    const { integratorId, appFee, appFeeRecipient } = readAcrossServerConfig(process.env);
    if (integratorId) query.set("integratorId", integratorId);
    if (appFee && appFeeRecipient) {
      query.set("appFee", String(appFee));
      query.set("appFeeRecipient", appFeeRecipient);
    }
  }
  try {
    const response = await fetch(`${upstream}?${query}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text.slice(0, 300) || `Across responded ${response.status}` };
    }
    if (!response.ok) console.warn(`[across] ${upstream} ${response.status}`);
    return NextResponse.json(body, { status: response.status, headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.warn(`[across] ${upstream} failed`, error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Across is unreachable right now." }, { status: 502 });
  }
}
