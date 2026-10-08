import { NextResponse, type NextRequest } from "next/server";
import { aggregatorEnabled, quoteAggregator, readAggregatorConfig } from "@/lib/venues/aggregators/server";
import { AGGREGATOR_PROVIDERS, type AggregatorProvider, type AggregatorQuoteRequest } from "@/lib/venues/aggregators/types";
import { EVM_SWAP_CHAINS } from "@/lib/venues/uniswap/chains";
import { sameOrigin } from "@/lib/same-origin";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** A 0x, Odos or KyberSwap quote for an EVM swap, with our fee added here (never by the browser). */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Partial<AggregatorQuoteRequest> | null;
  const config = readAggregatorConfig(process.env);
  if (!body || !AGGREGATOR_PROVIDERS.includes(body.provider as AggregatorProvider)) return NextResponse.json({ error: "Unknown aggregator." }, { status: 400 });
  if (!aggregatorEnabled(body.provider as AggregatorProvider, config)) return NextResponse.json({ error: "This aggregator isn't set up here." }, { status: 503 });
  if (
    !EVM_SWAP_CHAINS.some((chain) => chain.id === body.chainId) ||
    typeof body.sellToken !== "string" || !ADDRESS.test(body.sellToken) ||
    typeof body.buyToken !== "string" || !ADDRESS.test(body.buyToken) ||
    typeof body.sellAmount !== "string" || !/^\d{1,78}$/.test(body.sellAmount) ||
    (body.taker != null && (typeof body.taker !== "string" || !ADDRESS.test(body.taker)))
  ) {
    return NextResponse.json({ error: "Invalid swap." }, { status: 400 });
  }
  const slippageBps = Number.isInteger(body.slippageBps) && body.slippageBps! > 0 && body.slippageBps! <= 1000 ? body.slippageBps : 50;
  try {
    const quote = await quoteAggregator({ ...(body as AggregatorQuoteRequest), slippageBps }, config);
    return NextResponse.json(quote, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
