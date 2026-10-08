import { NextResponse, type NextRequest } from "next/server";
import { isSignedTransaction, sendAndConfirm } from "@/lib/solana/send-server";
import { readTitanServerConfig } from "@/lib/venues/titan/server";
import { rateLimited } from "@/lib/rate-limit";

/** Sends a wallet-signed Titan transaction through our RPC and waits for confirmation (Titan has no execute API). */
export async function POST(request: NextRequest) {
  const limited = rateLimited(request, "titan-execute", "send");
  if (limited) return limited;
  if (!readTitanServerConfig(process.env).apiKey) return NextResponse.json({ error: "Titan isn't configured." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { signedTransaction?: unknown } | null;
  if (!isSignedTransaction(body?.signedTransaction)) return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });
  const result = await sendAndConfirm(body.signedTransaction);
  if (result.status === "Failed" && result.error === "The transaction failed on-chain.") return NextResponse.json({ ...result, error: "The swap failed on-chain." });
  return NextResponse.json(result, { status: result.status === "Failed" && !result.signature ? 400 : 200 });
}
