import { VenueError } from "../types";

/**
 * Lighter answers with `{ code, message }` (codes in /docs/data-structures-constants-and-errors) and cancels
 * unfillable orders with a status. These turn both into something a trader can act on.
 */
const CODE_MESSAGES: Record<number, string> = {
  20013: "The Lighter trading key isn't registered for this account. Set up trading again.",
  21100: "This wallet has no Lighter account yet. Deposit USDC on Lighter first.",
  21104: "Lighter rejected the order nonce. Try again.",
  21108: "The Lighter trading key was replaced (another app may use the same key slot). Set up trading again.",
  21109: "The Lighter trading key isn't registered for this account. Set up trading again.",
  21111: "The account is close to liquidation; only orders that reduce risk are accepted.",
  21112: "The account is being liquidated.",
  21120: "Lighter rejected the signature. Set up trading again.",
  21126: "Deposit USDC on Lighter before registering a trading key.",
  21203: "This pool is frozen: Lighter only allows withdrawals from it.",
  21207: "Those pool shares aren't available to withdraw yet.",
  21209: "Lighter refused that deposit amount: pools take at least $5.",
  21210: "Lighter refused that withdrawal: at least $5 at a time, or the whole amount when less is left.",
  21211: "The pool doesn't have that much free right now. Try a smaller amount.",
  21301: "Not enough collateral. Deposit more USDC on Lighter.",
  21504: "Lighter didn't accept the wallet signature. Sign with the wallet connected here and try again.",
  21506: "Lighter is busy (too many pending transactions). Wait a moment and try again.",
  21507: "The account is below maintenance margin.",
  21508: "Not enough margin for this order. Lower the size or leverage, or deposit more USDC.",
  21602: "Lighter doesn't list this market.",
  21605: "This Lighter market isn't trading right now.",
  21701: "Size doesn't match this market's size step.",
  21702: "Price doesn't match this market's tick size.",
  21706: "Order is too small for this market's minimum.",
  21709: "That order is already filled or canceled.",
  21715: "That order is already filled or canceled.",
  21728: "An order with the same id already exists. Try again.",
  21732: "Reduce-only order would increase the position.",
  21733: "Price looks like a fat-finger error; Lighter refused it.",
  21734: "Price is too far from the mark price.",
  21738: "Reduce-only order would increase the position.",
  21739: "Not enough margin for this order. Lower the size or leverage, or deposit more USDC.",
  21113: "Leverage isn't allowed for this market.",
  21132: "Margin mode can't change while a position or order is open on this market.",
  23000: "Lighter is rate limiting this account. Wait a moment and try again.",
  23003: "Too many Lighter connections from this browser.",
  29500: "Lighter had an internal error. Try again.",
  29501: "Lighter timed out. Check your positions before trying again.",
};

/** Order statuses that end an order without (full) execution. */
const STATUS_MESSAGES: Record<string, string> = {
  "canceled-too-much-slippage": "No liquidity within the price limit. The market moved; try again.",
  "canceled-not-enough-liquidity": "Not enough liquidity on the book to fill this order.",
  "canceled-margin-not-allowed": "Not enough margin for this order. Lower the size or leverage, or deposit more USDC.",
  "canceled-position-not-allowed": "This position isn't allowed (open interest or position limit reached).",
  "canceled-reduce-only": "Reduce-only order would increase the position.",
  "canceled-self-trade": "The order would have traded against your own order.",
  "canceled-post-only": "Post-only order would have crossed the book.",
  "canceled-expired": "The order expired before it executed.",
  "canceled-liquidation": "The order was canceled by a liquidation.",
  "canceled-invalid-balance": "Not enough balance for this order.",
  canceled: "The order was canceled before it filled.",
};

const TEXT_RULES: Array<[RegExp, string]> = [
  [/invalid burn share amount/i, "Lighter refused that withdrawal: at least $5 at a time, or the whole amount when less is left."],
  [/invalid mint share amount/i, "Lighter refused that deposit amount: pools take at least $5."],
  [/burnt share usdc amount is too high/i, "The pool doesn't have that much free right now. Try a smaller amount."],
  [/user rejected|user denied|rejected the request/i, "Request rejected in the wallet."],
  [/failed to fetch|networkerror|load failed/i, "Can't reach Lighter. Check your connection and try again."],
  [/^http 429|too many requests/i, "Lighter is rate limiting this browser. Wait a moment and try again."],
];

export function humanizeLighterStatus(status: string) {
  return STATUS_MESSAGES[status] ?? (status.startsWith("canceled") ? STATUS_MESSAGES.canceled : `Order ended as ${status}.`);
}

export function humanizeLighterError(code: number | undefined, message: string) {
  if (code !== undefined && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  for (const [pattern, text] of TEXT_RULES) if (pattern.test(message)) return text;
  const raw = message.trim() || "Unknown error from Lighter";
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

/** Lighter's "no such account" answers: 21100 (account not found) and 29404 (`account?by=index` for an unknown index). */
export function isMissingAccountCode(code: number) {
  return code === 21100 || code === 29404;
}

/** An error answer from the Lighter API (code ≠ 200). */
export class LighterApiError extends VenueError {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(humanizeLighterError(code, message), `${code}: ${message}`);
    this.name = "LighterApiError";
  }
}

function rawMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as { shortMessage?: unknown; message?: unknown };
    if (typeof record.shortMessage === "string") return record.shortMessage;
    if (typeof record.message === "string") return record.message;
  }
  return "Unknown error from Lighter";
}

export function toLighterVenueError(error: unknown) {
  if (error instanceof VenueError) return error;
  const raw = rawMessage(error);
  return new VenueError(humanizeLighterError(undefined, raw), raw);
}
