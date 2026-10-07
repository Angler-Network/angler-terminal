import { NextResponse, type NextRequest } from "next/server";
import { sameOrigin } from "@/lib/same-origin";
import { lifiFetch, lifiQuoteQuery, readLifiServerConfig } from "@/lib/venues/lifi-server";

async function relay(response: Response) {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text.slice(0, 300) || `LI.FI responded ${response.status}` };
  }
  return NextResponse.json(body, { status: response.status, headers: { "cache-control": "no-store" } });
}

const TX_HASH = /^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,90})$/;

/**
 * GET /api/lifi/quote?… : a cross-chain quote with our integrator and fee added here (never by the browser).
 * GET /api/lifi/status?txHash=&fromChain=&toChain= : a sent route's progress.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  const config = readLifiServerConfig(process.env);
  const search = request.nextUrl.searchParams;
  let upstream: string;
  if (path === "quote") {
    if (!sameOrigin(request)) return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    const query = lifiQuoteQuery(search, config);
    if (!query) return NextResponse.json({ message: "Missing quote parameters." }, { status: 400 });
    upstream = `/quote?${query}`;
  } else if (path === "status") {
    const txHash = search.get("txHash") ?? "";
    const chains = ["fromChain", "toChain"].map((name) => search.get(name) ?? "");
    if (!TX_HASH.test(txHash) || chains.some((chain) => !/^\d{1,20}$/.test(chain))) return NextResponse.json({ message: "Bad status request." }, { status: 400 });
    upstream = `/status?${new URLSearchParams({ txHash, fromChain: chains[0], toChain: chains[1] })}`;
  } else {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }
  try {
    return await relay(await lifiFetch(upstream, config.apiKey));
  } catch {
    return NextResponse.json({ message: "LI.FI is unreachable right now." }, { status: 502 });
  }
}
