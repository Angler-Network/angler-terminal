import { NextResponse, type NextRequest } from "next/server";
import { sameOrigin } from "@/lib/same-origin";
import { isSignedTransaction, sendAndConfirm } from "@/lib/solana/send-server";
import { rateLimited } from "@/lib/rate-limit";

/** POST /api/solana/send: a wallet-signed transaction (LI.FI's Solana routes) sent through our RPC, confirmed. */
export async function POST(request: NextRequest) {
  const limited = rateLimited(request, "solana-send", "send");
  if (limited) return limited;
  if (!sameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { signedTransaction?: unknown } | null;
  if (!isSignedTransaction(body?.signedTransaction)) return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });
  const result = await sendAndConfirm(body.signedTransaction);
  return NextResponse.json(result, { status: result.status === "Failed" && !result.signature ? 400 : 200 });
}
