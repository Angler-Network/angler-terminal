import { NextResponse, type NextRequest } from "next/server";
import { allowEvent } from "@/lib/analytics/store";
import { EVM_SWAP_PROVIDERS, claimEvmSwap, type EvmSwapProvider } from "@/lib/profile/evm-swap-server";
import { clientIp, sameOrigin } from "@/lib/same-origin";

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Credits a finished EVM swap (Uniswap, 0x, KyberSwap, Arcus) to the wallet's profile. Body: `{ chainId, hash,
 * provider, wallet }`. The server reads the transaction itself and only counts it when it paid our fee, once.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await allowEvent(clientIp(request)))) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const body = (await request.json().catch(() => null)) as { chainId?: unknown; hash?: unknown; provider?: unknown; wallet?: unknown } | null;
  const chainId = Number(body?.chainId);
  const provider = body?.provider as EvmSwapProvider;
  if (!Number.isInteger(chainId) || typeof body?.hash !== "string" || !HASH.test(body.hash) || !EVM_SWAP_PROVIDERS.includes(provider) || typeof body?.wallet !== "string" || !ADDRESS.test(body.wallet)) {
    return NextResponse.json({ error: "Invalid swap." }, { status: 400 });
  }
  try {
    const result = await claimEvmSwap(chainId, body.hash, provider, body.wallet);
    return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (error) {
    return NextResponse.json({ error: `Couldn't check the swap: ${error instanceof Error ? error.message : String(error)}` }, { status: 502 });
  }
}
