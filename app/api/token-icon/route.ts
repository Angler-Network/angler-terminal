import { NextResponse, type NextRequest } from "next/server";
import { assets } from "@/lib/data";
import { fetchFirstImage } from "@/lib/favicon";
import { iconSources } from "@/lib/market-icons";

const SYMBOL_PATTERN = /^[A-Za-z0-9]{1,24}$/;

/**
 * GET /api/token-icon?symbol=BTC → the market's logo from the same sources the site's icons use, served from our own
 * origin so a canvas (the PnL share card) can draw it and still export. Only fixed hosts are fetched, by symbol.
 */
export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim() ?? "";
  if (!SYMBOL_PATTERN.test(symbol)) return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  const kind = request.nextUrl.searchParams.get("kind");
  const icon = await fetchFirstImage(iconSources(symbol, kind === "stock" || kind === "crypto" ? kind : assets[symbol]?.kind));
  if (!icon) return new NextResponse(null, { status: 404, headers: { "cache-control": "public, max-age=3600, s-maxage=86400" } });
  return new NextResponse(icon.body, {
    headers: {
      "content-type": icon.contentType,
      "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      "x-content-type-options": "nosniff",
      // Third-party SVGs on our origin: never let one run script or load anything if opened directly.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
