/**
 * Readable messages for Jupiter /order and /execute failures and wallet errors.
 * /order: match on router + errorCode (the same number means different things per router).
 * /execute: match on code, then on known program errors inside the error string.
 */

const AGGREGATOR_ROUTERS = new Set(["metis", "dflow", "okx"]);

export const MESSAGES = {
  insufficientBalance: "Insufficient balance for this swap.",
  insufficientSol: "Not enough SOL to pay network fees. Keep a little SOL (about 0.01) in the wallet.",
  priceMoved: "Price moved beyond the slippage limit. Nothing was swapped; review the new quote and try again.",
  expired: "The quote expired before it was submitted. Review the new quote and try again.",
  rejected: "Request rejected in the wallet.",
  landing: "The transaction didn't land on Solana. Nothing was swapped; try again.",
} as const;

export function orderErrorMessage(router: string | undefined, code: number | undefined, fallback?: string) {
  if (router === "jupiterz") {
    if (code === 1) return MESSAGES.insufficientBalance;
    if (code === 2) return "The wallet is missing a token account for this swap. Try again shortly or use a smaller size.";
    if (code === 3) return "The market maker quote couldn't be built into a transaction. Try again.";
  } else if (!router || AGGREGATOR_ROUTERS.has(router)) {
    if (code === 1) return MESSAGES.insufficientBalance;
    if (code === 2) return MESSAGES.insufficientSol;
    if (code === 3) return "Swap is below the minimum size for gasless execution.";
  }
  return fallback || "Jupiter couldn't build this swap.";
}

const PROGRAM_ERRORS: Array<[RegExp, string]> = [
  // Jupiter program 6001 SlippageToleranceExceeded (0x1771), 6017 ExactOutAmountNotMatched (0x1781)
  [/slippage|0x1771|\b6001\b|0x1781|\b6017\b|price moved/i, MESSAGES.priceMoved],
  // Jupiter program 6024 InsufficientFunds (0x1788), SPL token "insufficient funds" (0x1)
  [/insufficient lamports|insufficient funds for (fee|rent)|not enough sol/i, MESSAGES.insufficientSol],
  [/0x1788|\b6024\b|insufficient ?funds|insufficient balance/i, MESSAGES.insufficientBalance],
  [/blockhash not found|block height exceeded|expired/i, MESSAGES.expired],
];

export function executeErrorMessage(code: number | undefined, error?: string) {
  if (error) {
    for (const [pattern, message] of PROGRAM_ERRORS) if (pattern.test(error)) return message;
  }
  switch (code) {
    case -1:
    case -1004:
    case -2003:
      return MESSAGES.expired;
    case -2004:
      return "The market maker rejected the swap because the price moved. Review the new quote and try again.";
    case -1000:
    case -2000:
      return MESSAGES.landing;
    case -2:
    case -3:
    case -1002:
    case -1003:
    case -2002:
      return "The signed transaction was invalid. Try again, and make sure the wallet signs the transaction it was shown.";
    default:
      return error ? `Swap failed: ${error.slice(0, 160)}` : "Swap failed.";
  }
}

export function walletErrorMessage(error: unknown) {
  const record = (error ?? {}) as { code?: unknown; message?: unknown; name?: unknown };
  const message = typeof record.message === "string" ? record.message : String(error);
  if (record.code === 4001 || /reject|denied|declined|cancel/i.test(message) || record.name === "WalletSignTransactionError") {
    return MESSAGES.rejected;
  }
  return `Wallet error: ${message.slice(0, 160)}`;
}
