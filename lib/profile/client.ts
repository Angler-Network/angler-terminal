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

const extendedLinks = new Map<string, Promise<void>>();

/**
 * Links this browser's Extended account (set up for `wallet`) to the wallet's profile, so its trades through our builder
 * code count there. The account's API key goes to our server for one read of the account id (the proxy already relays it
 * on every Extended call); the Stark key never leaves the browser. Once per wallet and account in this browser.
 */
export function linkExtendedPoints(wallet: string): Promise<void> {
  const id = wallet.toLowerCase();
  const pending = extendedLinks.get(id);
  if (pending) return pending;
  const run = (async () => {
    const [{ extendedSession, readExtendedRecord }, { extendedConfig }] = await Promise.all([import("@/lib/venues/extended/store"), import("@/lib/venues/extended/config")]);
    const record = readExtendedRecord(id);
    if (!record || !extendedConfig.builderId) return;
    const flag = `angler:extended-points:${extendedConfig.network}:${id}:${record.accountId}`;
    try {
      if (window.localStorage.getItem(flag)) return;
    } catch {}
    const session = await extendedSession(id);
    if (!session) return;
    const response = await fetch("/api/profile/extended", {
      method: "POST",
      headers: { "content-type": "application/json", "x-extended-api-key": session.apiKey },
      body: JSON.stringify({ id }),
    });
    // Linked, or linked elsewhere for good: either way, asking again won't change it.
    if (response.ok || response.status === 409) {
      try {
        window.localStorage.setItem(flag, "1");
      } catch {}
    }
  })().catch(() => {});
  extendedLinks.set(id, run);
  // A failure can be retried on the next profile load.
  void run.then(() => extendedLinks.delete(id));
  return run;
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
