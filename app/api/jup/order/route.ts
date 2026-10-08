import type { NextRequest } from "next/server";
import { readSlippageBps } from "@/lib/trading/slippage";
import { isSolanaAddress } from "@/lib/venues/jupiter/config";
import { badRequest, jupFetch, jupServerConfig, relay, unreachable } from "@/lib/venues/jupiter/server";
import { rateLimited } from "@/lib/rate-limit";

/**
 * Proxies GET /swap/v2/order (Meta-Aggregator). The server adds the API key and our referral account and fee,
 * so neither can be read or changed from the browser.
 */
export async function GET(request: NextRequest) {
  const limited = rateLimited(request, "jup");
  if (limited) return limited;
  const incoming = request.nextUrl.searchParams;
  const inputMint = incoming.get("inputMint");
  const outputMint = incoming.get("outputMint");
  const amount = incoming.get("amount");
  const taker = incoming.get("taker");
  if (!isSolanaAddress(inputMint) || !isSolanaAddress(outputMint) || inputMint === outputMint) return badRequest("Invalid mints");
  if (!amount || !/^[1-9]\d{0,30}$/.test(amount)) return badRequest("Invalid amount");
  if (taker && !isSolanaAddress(taker)) return badRequest("Invalid taker");

  const params = new URLSearchParams({ inputMint, outputMint, amount });
  if (taker) params.set("taker", taker);
  // A fixed tolerance from the swap card's setting; without it Jupiter estimates slippage itself (RTSE).
  const slippageBps = readSlippageBps(incoming.get("slippageBps"));
  if (slippageBps !== null) params.set("slippageBps", String(slippageBps));
  const { referral } = jupServerConfig();
  if (referral) {
    params.set("referralAccount", referral.account);
    params.set("referralFee", String(referral.feeBps));
  }

  try {
    return relay(await jupFetch(`/swap/v2/order?${params}`));
  } catch {
    return unreachable();
  }
}
