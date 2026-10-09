"use client";

/** Fired after every trade; the profile refreshes shortly after, once the venue has recorded it. */
export const TRADE_EVENT = "angler:trade";

export function announceTrade() {
  try {
    window.dispatchEvent(new Event(TRADE_EVENT));
  } catch {}
}

/**
 * Asks the server to credit a finished Solana swap to the signer's profile. Fire-and-forget: the server reads the
 * transaction itself (only swaps that paid our fee count), and points never block a trade.
 */
export function claimSwapPoints(signature: string) {
  void fetch("/api/profile/swap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature }), keepalive: true })
    .then(() => announceTrade())
    .catch(() => {});
}

/**
 * The same for an EVM swap (Uniswap, 0x, KyberSwap, Arcus): the server reads the transaction on that chain and counts it
 * once when it paid our fee. Fire-and-forget.
 */
export function claimEvmSwapPoints(chainId: number, hash: string, provider: "uniswap" | "zerox" | "kyberswap" | "arcus", wallet: string) {
  void fetch("/api/profile/evm-swap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId, hash, provider, wallet }), keepalive: true })
    .then(() => announceTrade())
    .catch(() => {});
}
