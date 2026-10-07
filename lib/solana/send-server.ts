import "server-only";
import type { Base64EncodedWireTransaction } from "@solana/kit";
import { solanaRpc } from "@/lib/venues/titan/server";

const CONFIRM_TIMEOUT_MS = 40_000;

export type SendResult = { status: "Success"; signature: string } | { status: "Failed"; signature?: string; error: string };

/** A wallet-signed transaction (base64 wire bytes) is plausible: sizes outside this are never real Solana txs. */
export const isSignedTransaction = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9+/=]{100,3000}$/.test(value);

/** Sends a signed transaction through our RPC (`SOLANA_RPC_URL`) and waits up to 40s for confirmation. */
export async function sendAndConfirm(signed: string): Promise<SendResult> {
  const rpc = solanaRpc();
  let signature: string;
  try {
    signature = await rpc.sendTransaction(signed as Base64EncodedWireTransaction, { encoding: "base64", maxRetries: 3n, preflightCommitment: "confirmed" }).send();
  } catch (error) {
    return { status: "Failed", error: error instanceof Error ? error.message.split("\n")[0] : "The transaction was rejected." };
  }
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { value } = await rpc
      .getSignatureStatuses([signature as Parameters<typeof rpc.getSignatureStatuses>[0][number]])
      .send()
      .catch(() => ({ value: [null] }));
    const status = value[0];
    if (status?.err) return { status: "Failed", signature, error: "The transaction failed on-chain." };
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return { status: "Success", signature };
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { status: "Failed", signature, error: "Not confirmed yet. Check Solscan in a moment." };
}
