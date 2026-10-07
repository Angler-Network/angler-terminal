import { NextResponse, type NextRequest } from "next/server";
import { getPredictionEvents, searchPolymarket } from "@/lib/prediction/server";
import type { PredictionEvent } from "@/lib/prediction/types";

/**
 * Prediction events: `?source=all|polymarket|hyperliquid` (default all). With `?q=`, Polymarket's own search plus
 * HIP-4 events whose title matches. `failed` names a source that couldn't be read (the rest still answers).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const source = params.get("source") === "polymarket" || params.get("source") === "hyperliquid" ? (params.get("source") as "polymarket" | "hyperliquid") : "all";
  const query = params.get("q")?.trim().slice(0, 80) ?? "";
  const { events, failed } = await getPredictionEvents(query && source !== "hyperliquid" ? "hyperliquid" : source);
  let list: PredictionEvent[] = events;
  if (query) {
    const words = query.toLowerCase().split(/\s+/);
    const matches = (event: PredictionEvent) => words.every((word) => `${event.title} ${event.subtitle ?? ""}`.toLowerCase().includes(word));
    const local = source === "polymarket" ? [] : events.filter(matches);
    let remote: PredictionEvent[] = [];
    if (source !== "hyperliquid") {
      try {
        remote = await searchPolymarket(query.toLowerCase());
      } catch (error) {
        console.warn(`[prediction] Polymarket search failed: ${String(error)}`);
        failed.push("polymarket");
      }
    }
    list = [...remote, ...local];
  }
  return NextResponse.json({ events: list, failed }, { headers: { "cache-control": "public, s-maxage=10, stale-while-revalidate=30" } });
}
