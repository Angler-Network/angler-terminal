import { NextResponse, type NextRequest } from "next/server";
import { readAggregatorConfig, zeroxGaslessStatus } from "@/lib/venues/aggregators/server";
import { EVM_SWAP_CHAINS } from "@/lib/venues/uniswap/chains";

/** Where a submitted 0x Gasless trade is: GET ?hash=<tradeHash>&chainId=. */
export async function GET(request: NextRequest) {
  const config = readAggregatorConfig(process.env);
  if (!config.zeroxKey) return NextResponse.json({ error: "Gasless swaps aren't set up here." }, { status: 503 });
  const hash = request.nextUrl.searchParams.get("hash") ?? "";
  const chainId = Number(request.nextUrl.searchParams.get("chainId"));
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash) || !EVM_SWAP_CHAINS.some((chain) => chain.id === chainId)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    return NextResponse.json(await zeroxGaslessStatus(hash, chainId, config), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
