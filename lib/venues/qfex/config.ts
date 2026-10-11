/**
 * QFEX (qfex.com; docs docs.qfex.com, index docs.qfex.com/llms.txt): a 24/7 central limit order book for USDC-margined
 * perps on US equities, indices, commodities and FX. Mainnet only (its pre-production API needs credentials from QFEX),
 * so the testnet site doesn't offer it.
 *
 * Builder code: a UUID our QFEX account created (Developer Settings), `NEXT_PUBLIC_QFEX_BUILDER_CODE`. It rides on the
 * Trade WebSocket's auth message, so every order on that connection earns us `builder_fee_share_bps` of QFEX's own fee
 * (up to 50%); the trader pays nothing extra. Users connect with an API key they create on qfex.com (the wallet flow,
 * `/builder/web3/api-key`, needs QFEX to enable `register_user` on our builder key).
 * QFEX's REST API sends no CORS headers: the browser reaches it through our proxy (`app/api/qfex`); both WebSockets
 * (trade, market data) are open to browsers.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Our share of QFEX's fee (bps of the fee, 5000 = 50%) when the env doesn't say: the most QFEX allows. */
export const QFEX_DEFAULT_BUILDER_SHARE_BPS = 5000;

export function readQfexConfig(env: Record<string, string | undefined>) {
  const code = env.NEXT_PUBLIC_QFEX_BUILDER_CODE?.trim() ?? "";
  const share = Number(env.NEXT_PUBLIC_QFEX_BUILDER_SHARE_BPS);
  return {
    network: "mainnet" as const,
    api: "https://api.qfex.com",
    tradeWs: "wss://trade.qfex.com",
    marketWs: "wss://mds.qfex.com",
    app: "https://qfex.com",
    /** Where users create the API key Angler trades with. */
    keysUrl: "https://qfex.com/trade",
    builderCode: UUID.test(code) ? code.toLowerCase() : null,
    /** Our share of each fee, as a fraction (0.5 = half of what the trader pays QFEX). */
    builderShare: (Number.isFinite(share) && share >= 0 && share <= 5000 ? share : QFEX_DEFAULT_BUILDER_SHARE_BPS) / 10_000,
    /** Our proxy for QFEX's REST API (no CORS there). */
    proxy: "/api/qfex",
  };
}

export type QfexConfig = ReturnType<typeof readQfexConfig>;

export const qfexConfig = readQfexConfig({
  NEXT_PUBLIC_QFEX_BUILDER_CODE: process.env.NEXT_PUBLIC_QFEX_BUILDER_CODE,
  NEXT_PUBLIC_QFEX_BUILDER_SHARE_BPS: process.env.NEXT_PUBLIC_QFEX_BUILDER_SHARE_BPS,
});
