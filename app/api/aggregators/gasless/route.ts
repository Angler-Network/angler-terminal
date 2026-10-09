import { NextResponse, type NextRequest } from "next/server";
import { readAggregatorConfig, zeroxGaslessQuote } from "@/lib/venues/aggregators/server";
import type { AggregatorQuoteRequest } from "@/lib/venues/aggregators/types";
import { EVM_SWAP_CHAINS } from "@/lib/venues/uniswap/chains";
import { sameOrigin } from "@/lib/same-origin";
import { rateLimited } from "@/lib/rate-limit";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** A 0x Gasless quote (price-only, or firm with the payloads to sign when `execute` and `taker` are set), our fee added here. */
export async function POST(request: NextRequest) {
  const limited = rateLimited(request, "aggregators");
  if (limited) return limited;
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const config = readAggregatorConfig(process.env);
  if (!config.zeroxKey) return NextResponse.json({ error: "Gasless swaps aren't set up here." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as Partial<AggregatorQuoteRequest> | null;
  if (
    !body ||
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
    const quote = await zeroxGaslessQuote({ ...(body as AggregatorQuoteRequest), provider: "zerox", slippageBps }, config);
    return NextResponse.json(quote, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
