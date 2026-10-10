import { NextResponse, type NextRequest } from "next/server";
import { deployment } from "@/lib/deployment";
import { rateLimited } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/same-origin";
import { readExtendedConfig } from "@/lib/venues/extended/config";
import { EXTENDED_FORWARD_HEADERS, extendedProxyDecision, type ExtendedProxyMethod } from "@/lib/venues/extended/proxy";

/**
 * Our relay to Extended's REST API, which sends no CORS headers. It runs in Tokyo, next to Extended's servers, and applies
 * Extended's restricted-countries list to the visitor's own country (Vercel's geolocation headers): orders reach
 * Extended from this server's IP, so refusing restricted visitors here is what keeps them out. Orders arrive already
 * Stark-signed by the browser; the relay can't alter them, and it never stores or logs the API key it passes on.
 */
export const preferredRegion = "hnd1";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 10_000;

async function relay(request: NextRequest, params: Promise<{ network: string; path: string[] }>) {
  const { network, path } = await params;
  const method = request.method as ExtendedProxyMethod;
  const target = `/${path.join("/")}`;
  if (method !== "GET" && !sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const limited = rateLimited(request, "extended", method === "GET" ? "read" : "send");
  if (limited) return limited;
  const decision = extendedProxyDecision({
    method,
    path: target,
    network,
    // On Vercel a missing country counts as restricted; local development has no geolocation header at all.
    country: request.headers.get("x-vercel-ip-country") ?? (process.env.VERCEL ? null : "XX"),
    region: request.headers.get("x-vercel-ip-country-region"),
    pinned: deployment,
  });
  if (!decision.ok) {
    return NextResponse.json(decision.restricted ? { error: "Extended isn't available in your country.", restricted: true } : { error: "Not found" }, { status: decision.status });
  }
  const config = readExtendedConfig({ NEXT_PUBLIC_EXTENDED_NETWORK: network }, null);
  const headers = new Headers({ "user-agent": "AnglerTerminal/1.0 (+https://trade.angler.network)", accept: "application/json" });
  for (const name of EXTENDED_FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const body = method === "GET" || method === "DELETE" ? undefined : await request.text();
  try {
    const upstream = await fetch(`${config.host}${target}${request.nextUrl.search}`, { method, headers, body, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await upstream.text();
    const publicData = target.startsWith("/api/v1/info/");
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": publicData && method === "GET" && upstream.ok ? "public, max-age=1, s-maxage=2" : "no-store",
      },
    });
  } catch (error) {
    console.warn(`[extended] relay ${method} ${target}: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json({ error: "Extended didn't answer." }, { status: 502 });
  }
}

type Context = { params: Promise<{ network: string; path: string[] }> };

export const GET = (request: NextRequest, context: Context) => relay(request, context.params);
export const POST = (request: NextRequest, context: Context) => relay(request, context.params);
export const PATCH = (request: NextRequest, context: Context) => relay(request, context.params);
export const DELETE = (request: NextRequest, context: Context) => relay(request, context.params);
