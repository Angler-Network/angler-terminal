import { NextResponse } from "next/server";
import { ASTER_API_URL, asterFundingRows, type AsterFundingInfo, type AsterPremium } from "@/lib/venues/aster/funding";
import { ORDERLY_MAINNET_API, orderlyFundingRows } from "@/lib/venues/orderly/funding";

/**
 * Funding across venues, always mainnet (testnet funding means nothing): Lighter's aggregated feed (Hyperliquid,
 * Lighter, Binance, Bybit) plus Aster's and Orderly's own rates, merged as one `funding_rates` list. Either failing
 * leaves the rest.
 */
const FUNDING_URL = "https://mainnet.zklighter.elliot.ai/api/v1/funding-rates";
/** Lighter RH's own feed: its "lighter" rows are RH's markets (the core feed has none of them). */
const RH_FUNDING_URL = "https://api.rh.lighter.xyz/api/v1/funding-rates";

async function lighterRhRows(): Promise<unknown[]> {
  try {
    const response = await fetch(RH_FUNDING_URL, { next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) });
    const body = response.ok ? ((await response.json()) as { funding_rates?: unknown }) : null;
    const rows = Array.isArray(body?.funding_rates) ? (body.funding_rates as Array<Record<string, unknown>>) : [];
    return rows.filter((row) => row.exchange === "lighter").map((row) => ({ ...row, exchange: "lighterRh" }));
  } catch {
    return [];
  }
}

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

async function orderlyRows() {
  try {
    const [futures, info] = await Promise.all(
      ["futures", "info"].map((path) =>
        fetch(`${ORDERLY_MAINNET_API}/v1/public/${path}`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) })
          .then((response) => (response.ok ? response.json() : null))
          .then((body: { data?: { rows?: unknown[] } } | null) => (Array.isArray(body?.data?.rows) ? body.data.rows : [])),
      ),
    );
    return orderlyFundingRows(futures as Parameters<typeof orderlyFundingRows>[0], info as Parameters<typeof orderlyFundingRows>[1]);
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const [response, aster, orderly, rh] = await Promise.all([fetch(FUNDING_URL, { next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) }), asterRows(), orderlyRows(), lighterRhRows()]);
    if (!response.ok) return NextResponse.json({ error: `Funding source answered ${response.status}` }, { status: 502 });
    const body = (await response.json()) as { funding_rates?: unknown[] };
    const rows = [...(Array.isArray(body.funding_rates) ? body.funding_rates : []), ...aster, ...orderly, ...rh];
    return NextResponse.json({ ...body, funding_rates: rows }, { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ error: "Funding rates are unavailable right now." }, { status: 502 });
  }
}
