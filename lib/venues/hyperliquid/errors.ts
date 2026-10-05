import { VenueError } from "../types";

/**
 * Hyperliquid returns plain English errors; these rewrite the common ones into something a trader can act on.
 * Order is significant: the first matching rule wins.
 */
const rules: Array<[RegExp, string | ((match: RegExpMatchArray) => string)]> = [
  [/insufficient margin/i, "Not enough margin for this order. Lower the size or leverage, or deposit more USDC."],
  [
    /minimum value of \$?([\d.]+)/i,
    (match) => `Order is too small. Hyperliquid's minimum order value is $${match[1]}.`,
  ],
  [/(price|order).*too far|away from the reference price|price.*out of bounds/i, "Price is too far from the market price. Move it closer to the mark."],
  [/could not immediately match/i, "No liquidity at an acceptable price. The market moved; try again or raise slippage."],
  [/tick size|invalid price|price must be divisible/i, "Price doesn't match this market's tick size."],
  [/invalid size|size must be|lot size/i, "Size doesn't match this market's lot size."],
  [/reduce only order would increase position/i, "Reduce-only order would increase the position."],
  [/builder fee has not been approved|builder.*not approved|max builder fee/i, "Builder fee isn't approved yet. Run the trading setup again."],
  [
    /(user or api wallet|agent).*(does not exist|not found)|must deposit before performing actions/i,
    "This wallet has no Hyperliquid account yet, or the trading key was revoked. Deposit USDC, then set up trading again.",
  ],
  [/leverage.*(invalid|exceed|too high)|cannot (switch|change) leverage/i, "Leverage isn't allowed for this market or position."],
  [/too many (cumulative )?requests|rate limit/i, "Hyperliquid is rate limiting this account. Wait a moment and try again."],
  [/order has (already been canceled|been filled)|already canceled|never placed/i, "That order is already filled or canceled."],
  [/open interest.*cap|at open interest cap/i, "This market is at its open interest cap; only reducing orders are accepted."],
  [/user rejected|user denied|rejected the request/i, "Request rejected in the wallet."],
];

export function humanizeHlError(input: string) {
  // The SDK prefixes bulk statuses with their position, e.g. "order 0: Insufficient margin..."
  const raw = input.replace(/^(order|cancel|modify) \d+: /i, "");
  for (const [pattern, message] of rules) {
    const match = raw.match(pattern);
    if (match) return typeof message === "function" ? message(match) : message;
  }
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as { response?: unknown; message?: unknown; shortMessage?: unknown };
    const response = record.response as { response?: unknown; status?: unknown } | undefined;
    if (response && typeof response.response === "string") return response.response;
    if (typeof record.shortMessage === "string") return record.shortMessage;
    if (typeof record.message === "string") return record.message;
  }
  return "Unknown error from Hyperliquid";
}

export function toVenueError(error: unknown) {
  if (error instanceof VenueError) return error;
  const raw = rawMessage(error);
  return new VenueError(humanizeHlError(raw), raw);
}
