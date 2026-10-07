import { NextResponse, type NextRequest } from "next/server";
import { getPredictionBook } from "@/lib/prediction/server";

/** An outcome's order book, best levels first: `?source=polymarket&asset=<token id>` or `?source=hyperliquid&asset=#N`. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const source = params.get("source");
  const asset = params.get("asset") ?? "";
  const valid = (source === "polymarket" && /^\d{1,90}$/.test(asset)) || (source === "hyperliquid" && /^#\d{1,12}$/.test(asset));
  if (!valid) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    return NextResponse.json(await getPredictionBook(source, asset), { headers: { "cache-control": "public, s-maxage=2, stale-while-revalidate=5" } });
  } catch (error) {
    return NextResponse.json({ error: `Couldn't read the book: ${error instanceof Error ? error.message : String(error)}` }, { status: 502 });
  }
}
