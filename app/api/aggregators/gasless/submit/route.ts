import { NextResponse, type NextRequest } from "next/server";
import { readAggregatorConfig, zeroxGaslessSubmit, type GaslessSubmitRequest } from "@/lib/venues/aggregators/server";
import { EVM_SWAP_CHAINS } from "@/lib/venues/uniswap/chains";
import { sameOrigin } from "@/lib/same-origin";
import { rateLimited } from "@/lib/rate-limit";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

/** A signed EIP-712 part as the wallet produced it: the quote's payload plus an EIP-712 signature split into v/r/s. */
function signedPart(value: unknown) {
  const part = (value ?? {}) as Record<string, unknown>;
  const signature = (part.signature ?? {}) as Record<string, unknown>;
  const eip712 = part.eip712 as Record<string, unknown> | undefined;
  return (
    typeof part.type === "string" &&
    part.type.length <= 64 &&
    eip712 !== undefined &&
    typeof eip712 === "object" &&
    typeof eip712.primaryType === "string" &&
    signature.signatureType === 2 &&
    (signature.v === 27 || signature.v === 28) &&
    typeof signature.r === "string" &&
    HEX32.test(signature.r) &&
    typeof signature.s === "string" &&
    HEX32.test(signature.s)
  );
}

/** Hands a signed 0x Gasless trade (and optional gasless approval) to 0x's relayer. */
export async function POST(request: NextRequest) {
  const limited = rateLimited(request, "aggregators");
  if (limited) return limited;
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const config = readAggregatorConfig(process.env);
  if (!config.zeroxKey) return NextResponse.json({ error: "Gasless swaps aren't set up here." }, { status: 503 });
  const text = await request.text().catch(() => "");
  if (text.length > 64_000) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  let body: Partial<GaslessSubmitRequest> | null = null;
  try {
    body = JSON.parse(text) as Partial<GaslessSubmitRequest>;
  } catch {}
  if (!body || !EVM_SWAP_CHAINS.some((chain) => chain.id === body.chainId) || !signedPart(body.trade) || (body.approval != null && !signedPart(body.approval))) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    return NextResponse.json(await zeroxGaslessSubmit(body as GaslessSubmitRequest, config));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
