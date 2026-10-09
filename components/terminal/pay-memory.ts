"use client";

/**
 * The pay token last chosen in a swap card, shared by the EVM card and the Solana one. Each card is rebuilt for every
 * token, so without this, picking a token on another chain fell back to that chain's own dollar: USDC on Base became
 * USDG for a Robinhood token, SOL became USDG too (the Solana card's choice never reached the EVM card). Kept, the card
 * crosses chains instead, like Uniswap keeps the input token. Every card writes what it shows, defaults included (the
 * untouched USDC · Solana /swap opens with must carry over too). A Solana token rides as `LIFI_SOLANA_CHAIN` with its mint.
 */
export type PayChoice = { kind: "token"; chainId: number; address: string; symbol: string; decimals?: number; icon?: string; price?: number } | { kind: "hyperliquid" };

let last: PayChoice | null = null;

export function rememberPay(choice: PayChoice) {
  last = choice;
}

export function rememberedPay() {
  return last;
}
