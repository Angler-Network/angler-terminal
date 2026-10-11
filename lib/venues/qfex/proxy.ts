/**
 * What our QFEX proxy relays (`app/api/qfex/[...path]`): the public market data the terminal reads and the account
 * reads signed in the browser (HMAC headers; the secret never reaches us). Orders don't pass here: they go over QFEX's
 * Trade WebSocket straight from the browser. Pure: tested.
 */

const RULES: Array<{ path: RegExp; public: boolean }> = [
  { path: /^\/refdata$/, public: true },
  { path: /^\/md\/contracts$/, public: true },
  { path: /^\/md\/orderbook\/[A-Z0-9.]{1,20}-[A-Z]{3}$/, public: true },
  { path: /^\/candles\/[A-Z0-9.]{1,20}-[A-Z]{3}$/, public: true },
  { path: /^\/user\/(positions|fees|historic-orders|trade|volume)$/, public: false },
];

/** Request headers passed through to QFEX; everything else is dropped. */
export const QFEX_FORWARD_HEADERS = ["x-qfex-public-key", "x-qfex-nonce", "x-qfex-timestamp", "x-qfex-hmac-signature"];

export function qfexProxyRule(method: string, path: string): { public: boolean } | null {
  if (method !== "GET") return null;
  const rule = RULES.find((entry) => entry.path.test(path));
  return rule ? { public: rule.public } : null;
}
