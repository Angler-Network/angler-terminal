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

const claimedRoutes = new Set<string>();

/**
 * And for a finished Relay request (its request id), LI.FI transfer (its origin transaction hash) or Across deposit
 * (`<originChainId>:<depositId>`): the server reads
 * the bridge's own record. Called by the fill checks, which can report "filled" more than once: asked once per route.
 */
export function claimBridgePoints(provider: "relay" | "lifi" | "across", id: string) {
  const key = `${provider}:${id}`;
  if (!id || claimedRoutes.has(key)) return;
  claimedRoutes.add(key);
  void fetch("/api/profile/bridge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, id }), keepalive: true })
    .then(() => announceTrade())
    .catch(() => {});
}
