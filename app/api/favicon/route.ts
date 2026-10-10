import { NextResponse, type NextRequest } from "next/server";
import { fetchFavicon, normalizeDomain } from "@/lib/favicon";

/**
 * Logos we host ourselves where the site's favicon reads badly: Extended's favicon is a green mark on an opaque white
 * square, so its own transparent SVG (from extended.exchange) stands in.
 */
const LOCAL_ICONS: Record<string, string> = { "extended.exchange": "/venues/extended.svg" };

/** GET /api/favicon?domain=reuters.com → the site's favicon, cached for a day in browsers and a week at the CDN. */
export async function GET(request: NextRequest) {
  const domain = normalizeDomain(request.nextUrl.searchParams.get("domain"));
  if (!domain) return NextResponse.json({ error: "Invalid domain" }, { status: 400 });
  const local = LOCAL_ICONS[domain];
  if (local) return NextResponse.redirect(new URL(local, request.url), { status: 308, headers: { "cache-control": "public, max-age=86400, s-maxage=604800" } });

  const icon = await fetchFavicon(domain);
  if (!icon) {
    return new NextResponse(null, { status: 404, headers: { "cache-control": "public, max-age=3600, s-maxage=86400" } });
  }
  return new NextResponse(icon.body, {
    headers: {
      "content-type": icon.contentType,
      "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
