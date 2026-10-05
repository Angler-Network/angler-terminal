import { NextResponse } from "next/server";

/** Lighter's aggregated funding (Hyperliquid, Lighter, Binance, Bybit), always mainnet; testnet funding means nothing. */
const FUNDING_URL = "https://mainnet.zklighter.elliot.ai/api/v1/funding-rates";

export const revalidate = 60;

export async function GET() {
  try {
    const response = await fetch(FUNDING_URL, { next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return NextResponse.json({ error: `Funding source answered ${response.status}` }, { status: 502 });
    return NextResponse.json(await response.json(), { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ error: "Funding rates are unavailable right now." }, { status: 502 });
  }
}
