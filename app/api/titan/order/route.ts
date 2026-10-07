import { readSlippageBps } from "@/lib/trading/slippage";
import { NextResponse, type NextRequest } from "next/server";
import { isSolanaAddress } from "@/lib/venues/jupiter/config";
import { readTitanFeeConfig, titanFeeParams } from "@/lib/venues/titan/fees";
import { readTitanRoute, titanErrorMessage } from "@/lib/venues/titan/route";
import { buildTitanTransaction, readTitanServerConfig, titanFetch } from "@/lib/venues/titan/server";

const SLIPPAGE_BPS = 50;

/**
 * Titan quote for the spot trader to compare with Jupiter, with the unsigned transaction for the taker assembled
 * here so the browser doesn't need a Solana SDK. 503 when TITAN_API_KEY isn't set.
 */
export async function GET(request: NextRequest) {
  if (!readTitanServerConfig(process.env).apiKey) return NextResponse.json({ error: "Titan isn't configured." }, { status: 503 });
  const incoming = request.nextUrl.searchParams;
  const inputMint = incoming.get("inputMint");
  const outputMint = incoming.get("outputMint");
  const amount = incoming.get("amount");
  const taker = incoming.get("taker");
  if (!isSolanaAddress(inputMint) || !isSolanaAddress(outputMint) || !/^\d{1,20}$/.test(amount ?? "") || !isSolanaAddress(taker)) {
    return NextResponse.json({ error: "Invalid swap parameters" }, { status: 400 });
  }
  const feeParams = titanFeeParams(await readTitanFeeConfig(process.env), inputMint!, outputMint!);
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount!,
    // Instructions are built for this wallet's token accounts.
    userPublicKey: taker!,
    slippageBps: String(readSlippageBps(incoming.get("slippageBps")) ?? SLIPPAGE_BPS),
    numQuotes: "3",
    includeAltContents: "true",
    titanSwapVersion: "3",
    // Partner fee in USDC (TITAN_FEE_WALLET + TITAN_FEE_BPS), when configured.
    ...feeParams,
  });
  let response: Response;
  try {
    response = await titanFetch(`/api/v1/quote/swap?${params}`);
  } catch {
    return NextResponse.json({ error: "Titan is unreachable right now." }, { status: 502 });
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) return NextResponse.json({ error: titanErrorMessage(response.status, body) }, { status: response.status === 404 ? 404 : 502 });
  const route = readTitanRoute(body);
  if (!route) return NextResponse.json({ error: "Titan found no route for this swap." }, { status: 404 });

  let built: { transaction: string; lastValidBlockHeight: number };
  try {
    built = await buildTitanTransaction(route, taker!);
  } catch {
    return NextResponse.json({ error: "Couldn't build the Titan transaction." }, { status: 502 });
  }
  return NextResponse.json(
    {
      quoteId: route.quoteId,
      provider: route.provider,
      inAmount: route.inAmount.toString(),
      outAmount: route.outAmount.toString(),
      minOutAmount: route.minOutAmount.toString(),
      slippageBps: route.slippageBps,
      priceImpactPct: route.priceImpactPct,
      inUsdValue: route.inUsdValue,
      outUsdValue: route.outUsdValue,
      labels: route.labels,
      feeBps: Number(feeParams.feeBps) || 0,
      transaction: built.transaction,
      lastValidBlockHeight: built.lastValidBlockHeight,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
