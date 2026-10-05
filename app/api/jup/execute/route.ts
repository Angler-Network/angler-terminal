import type { NextRequest } from "next/server";
import { badRequest, jupFetch, relay, unreachable } from "@/lib/venues/jupiter/server";

const MAX_TRANSACTION_LENGTH = 4096;

/** Proxies POST /swap/v2/execute: Jupiter lands the signed transaction and reports the outcome. */
export async function POST(request: NextRequest) {
  let body: { signedTransaction?: unknown; requestId?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  const { signedTransaction, requestId } = body;
  if (typeof signedTransaction !== "string" || !signedTransaction || signedTransaction.length > MAX_TRANSACTION_LENGTH) {
    return badRequest("Invalid signed transaction");
  }
  if (typeof requestId !== "string" || !requestId || requestId.length > 200) return badRequest("Invalid requestId");

  try {
    return relay(
      await jupFetch("/swap/v2/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedTransaction, requestId }),
      }),
    );
  } catch {
    return unreachable();
  }
}
