import { NextResponse, type NextRequest } from "next/server";
import { rateLimited } from "@/lib/rate-limit";
import { qfexConfig } from "@/lib/venues/qfex/config";
import { QFEX_FORWARD_HEADERS, qfexProxyRule } from "@/lib/venues/qfex/proxy";

/**
 * Our relay to QFEX's REST API, which sends no CORS headers: public market data, and account reads the browser signs
 * itself (HMAC headers passed through; the API secret never reaches this server). Orders don't come here: they go over
 * QFEX's Trade WebSocket from the browser. Frankfurt, outside the countries QFEX doesn't serve (the US among them).
 */
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 10_000;

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const target = `/${(await params).path.join("/")}`;
  const rule = qfexProxyRule("GET", target);
  if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = rateLimited(request, "qfex", "read");
  if (limited) return limited;
  const headers = new Headers({ "user-agent": "AnglerTerminal/1.0 (+https://trade.angler.network)", accept: "application/json" });
  if (!rule.public) {
    for (const name of QFEX_FORWARD_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
  }
  try {
    const upstream = await fetch(`${qfexConfig.api}${target}${request.nextUrl.search}`, { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": rule.public && upstream.ok ? "public, max-age=1, s-maxage=2" : "no-store",
      },
    });
  } catch (error) {
    console.warn(`[qfex] relay ${target}: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json({ error: "QFEX didn't answer." }, { status: 502 });
  }
}
