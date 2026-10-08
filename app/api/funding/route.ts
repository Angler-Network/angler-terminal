import { NextResponse } from "next/server";
import { ASTER_API_URL, asterFundingRows, type AsterFundingInfo, type AsterPremium } from "@/lib/venues/aster/funding";

/**
 * Funding across venues, always mainnet (testnet funding means nothing): Lighter's aggregated feed (Hyperliquid,
 * Lighter, Binance, Bybit) plus Aster's own rates, merged as one `funding_rates` list. Aster failing leaves the rest.
 */
const FUNDING_URL = "https://mainnet.zklighter.elliot.ai/api/v1/funding-rates";

export const revalidate = 60;

async function asterRows() {
  try {
    const [premium, info] = await Promise.all(
      ["premiumIndex", "fundingInfo"].map((path) =>
        fetch(`${ASTER_API_URL}/fapi/v1/${path}`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) }).then((response) => (response.ok ? response.json() : [])),
      ),
    );
    return asterFundingRows(Array.isArray(premium) ? (premium as AsterPremium[]) : [], Array.isArray(info) ? (info as AsterFundingInfo[]) : []);
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const [response, aster] = await Promise.all([fetch(FUNDING_URL, { next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) }), asterRows()]);
    if (!response.ok) return NextResponse.json({ error: `Funding source answered ${response.status}` }, { status: 502 });
    const body = (await response.json()) as { funding_rates?: unknown[] };
    const rows = [...(Array.isArray(body.funding_rates) ? body.funding_rates : []), ...aster];
    return NextResponse.json({ ...body, funding_rates: rows }, { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ error: "Funding rates are unavailable right now." }, { status: 502 });
  }
}
