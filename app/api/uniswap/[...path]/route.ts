import { NextResponse, type NextRequest } from "next/server";
import { sameOrigin } from "@/lib/same-origin";
import { UNISWAP_CHAIN_IDS } from "@/lib/venues/uniswap/config";
import { readUniswapServerConfig, uniswapFetch, withIntegratorFee } from "@/lib/venues/uniswap/server";
import { rateLimited } from "@/lib/rate-limit";

/** Trading API endpoints the terminal uses; nothing else is proxied. */
const POST_PATHS = new Set(["check_approval", "quote", "swap", "order"]);
const GET_PATHS = new Set(["orders", "swaps"]);
const MAX_BODY = 200_000;

async function relay(response: Response) {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { detail: text.slice(0, 300) || `Uniswap responded ${response.status}` };
  }
  return NextResponse.json(body, { status: response.status, headers: { "cache-control": "no-store" } });
}

const unreachable = () => NextResponse.json({ detail: "Uniswap is unreachable right now." }, { status: 502 });
const notConfigured = () => NextResponse.json({ detail: "Uniswap isn't available on this site." }, { status: 503 });
const sameChainSupported = (body: Record<string, unknown>) =>
  body.tokenInChainId === body.tokenOutChainId && (UNISWAP_CHAIN_IDS as readonly unknown[]).includes(body.tokenInChainId);

/** GET /api/uniswap/orders?orderId= (UniswapX status) and /swaps?txHashes=&chainId= (transaction status). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const limited = rateLimited(request, "uniswap");
  if (limited) return limited;
  const [endpoint, ...rest] = (await params).path;
  if (rest.length > 0 || !GET_PATHS.has(endpoint)) return NextResponse.json({ detail: "Not found" }, { status: 404 });
  const { apiKey } = readUniswapServerConfig(process.env);
  if (!apiKey) return notConfigured();
  const search = request.nextUrl.searchParams.size ? `?${request.nextUrl.searchParams}` : "";
  try {
    return await relay(await uniswapFetch(`/${endpoint}${search}`, apiKey));
  } catch {
    return unreachable();
  }
}

/**
 * POST check_approval, quote, swap and order. Quotes get our integrator fee here (any fee the browser sent is
 * dropped) and are limited to single-chain swaps on the chains the terminal supports.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const limited = rateLimited(request, "uniswap");
  if (limited) return limited;
  const path = (await params).path;
  const endpoint = path[0];
  if (path.length !== 1 || !POST_PATHS.has(endpoint)) return NextResponse.json({ detail: "Not found" }, { status: 404 });
  if (!sameOrigin(request)) return NextResponse.json({ detail: "Forbidden" }, { status: 403 });
  const { apiKey, fee } = readUniswapServerConfig(process.env);
  if (!apiKey) return notConfigured();

  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ detail: "Request too large." }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ detail: "Invalid body." }, { status: 400 });

  let headers: Record<string, string> = { "content-type": "application/json" };
  if (endpoint === "quote") {
    if (!sameChainSupported(body)) return NextResponse.json({ detail: "This chain isn't supported." }, { status: 400 });
    const priced = withIntegratorFee(body, fee);
    body = priced.body;
    headers = { ...headers, ...priced.headers };
  }
  try {
    return await relay(await uniswapFetch(`/${endpoint}`, apiKey, { method: "POST", body: JSON.stringify(body), headers }));
  } catch {
    return unreachable();
  }
}
