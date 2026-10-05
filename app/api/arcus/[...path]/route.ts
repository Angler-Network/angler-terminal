import { NextResponse, type NextRequest } from "next/server";
import { arcusFetch, readArcusServerConfig } from "@/lib/venues/arcus/server";

/** Router endpoints the terminal uses; nothing else is proxied. */
const GET_PATHS = new Set(["tokens", "price", "quote", "status"]);

async function relay(response: Response) {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 300) || `Arcus responded ${response.status}` };
  }
  return NextResponse.json(body, { status: response.status, headers: { "cache-control": "no-store" } });
}

const unreachable = () => NextResponse.json({ error: "Arcus is unreachable right now." }, { status: 502 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const [endpoint, ...rest] = (await params).path;
  if (rest.length > 0 || !GET_PATHS.has(endpoint)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const query = new URLSearchParams(request.nextUrl.searchParams);
  const { builderFeeBps } = readArcusServerConfig(process.env);
  if (endpoint === "quote") {
    query.delete("builderFeeBps");
    if (builderFeeBps) query.set("builderFeeBps", String(builderFeeBps));
  }
  const search = query.size ? `?${query}` : "";
  try {
    return await relay(
      await arcusFetch(`/v1/${endpoint}${search}`, endpoint === "tokens" ? { next: { revalidate: 300 } } : { cache: "no-store" }),
    );
  } catch {
    return unreachable();
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path;
  if (path.length !== 1 || path[0] !== "submit") return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // The fee must match the one quoted, and only the server decides it.
  const { builderFeeBps } = readArcusServerConfig(process.env);
  delete body.builderFeeBps;
  if (builderFeeBps) body.builderFeeBps = builderFeeBps;
  try {
    return await relay(
      await arcusFetch("/v1/submit", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, cache: "no-store" }),
    );
  } catch {
    return unreachable();
  }
}
