import { NextResponse, type NextRequest } from "next/server";
import { isPredictionRange } from "@/lib/prediction/market-data";
import { getPriceHistory } from "@/lib/prediction/server";

/** An outcome's price history: `?source=polymarket&asset=<token id>` or `?source=hyperliquid&asset=#N`, `range=1d|1w|1m|all`. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const source = params.get("source");
  const asset = params.get("asset") ?? "";
  const range = params.get("range") ?? "1w";
  const valid = (source === "polymarket" && /^\d{1,90}$/.test(asset)) || (source === "hyperliquid" && /^#\d{1,12}$/.test(asset));
  if (!valid || !isPredictionRange(range)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    const points = await getPriceHistory(source, asset, range);
    return NextResponse.json({ points }, { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } });
  } catch (error) {
    return NextResponse.json({ error: `Couldn't read the history: ${error instanceof Error ? error.message : String(error)}` }, { status: 502 });
  }
}
