import { NextResponse, type NextRequest } from "next/server";
import { resolvePolymarketSlug } from "@/lib/prediction/server";

/** GET /api/prediction/resolve?slug= : a Polymarket market slug (from the trades feed) → `{ id: "pm:<event id>" }`. */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug") ?? "";
  if (!/^[a-z0-9-]{1,200}$/.test(slug)) return NextResponse.json({ error: "Bad slug." }, { status: 400 });
  try {
    const id = await resolvePolymarketSlug(slug);
    if (!id) return NextResponse.json({ error: "Polymarket has no event for that market." }, { status: 404 });
    return NextResponse.json({ id }, { headers: { "cache-control": "public, s-maxage=3600" } });
  } catch {
    return NextResponse.json({ error: "Polymarket is unreachable right now." }, { status: 502 });
  }
}
