import type { Base64EncodedWireTransaction } from "@solana/kit";
import { NextResponse, type NextRequest } from "next/server";
import { readTitanServerConfig, solanaRpc } from "@/lib/venues/titan/server";

const CONFIRM_TIMEOUT_MS = 40_000;

/** Sends a wallet-signed Titan transaction through our RPC and waits for confirmation (Titan has no execute API). */
export async function POST(request: NextRequest) {
  if (!readTitanServerConfig(process.env).apiKey) return NextResponse.json({ error: "Titan isn't configured." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { signedTransaction?: unknown } | null;
  const signed = typeof body?.signedTransaction === "string" ? body.signedTransaction : "";
  if (!/^[A-Za-z0-9+/=]{100,3000}$/.test(signed)) return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });

  const rpc = solanaRpc();
  let signature: Awaited<ReturnType<ReturnType<typeof rpc.sendTransaction>["send"]>>;
  try {
    signature = await rpc
      .sendTransaction(signed as Base64EncodedWireTransaction, { encoding: "base64", maxRetries: 3n, preflightCommitment: "confirmed" })
      .send();
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "The transaction was rejected.";
    return NextResponse.json({ status: "Failed", error: message }, { status: 400 });
  }
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { value } = await rpc
      .getSignatureStatuses([signature])
      .send()
      .catch(() => ({ value: [null] }));
    const status = value[0];
    if (status?.err) return NextResponse.json({ status: "Failed", signature, error: "The swap failed on-chain." }, { status: 200 });
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) {
      return NextResponse.json({ status: "Success", signature });
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return NextResponse.json({ status: "Failed", signature, error: "Not confirmed yet. Check Solscan in a moment." }, { status: 200 });
}
