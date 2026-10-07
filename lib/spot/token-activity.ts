import type { PoolNetwork } from "./pool-candles";

/**
 * The swap view's activity tabs for the traded token: recent swaps in its busiest pool (GeckoTerminal / CoinGecko
 * on-chain `pools/{pool}/trades`, the last 300 over 24h) and its largest holders (Solana RPC `getTokenLargestAccounts`
 * + their owners). Pure, unit-tested.
 */

export interface TokenTrade {
  tx: string;
  /** Unix ms. */
  at: number;
  trader: string;
  /** From the token's side: the trader received it (buy) or gave it up (sell). */
  side: "buy" | "sell";
  amount: number;
  usd: number;
  /** The token's USD price in this trade. */
  price: number;
}

const sameAddress = (network: PoolNetwork, a: unknown, b: string) =>
  typeof a === "string" && (network === "solana" ? a === b : a.toLowerCase() === b.toLowerCase());

export function readPoolTrades(body: unknown, network: PoolNetwork, token: string): TokenTrade[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry): TokenTrade[] => {
    const trade = ((entry as { attributes?: Record<string, unknown> })?.attributes ?? {}) as Record<string, unknown>;
    const bought = sameAddress(network, trade.to_token_address, token);
    const sold = sameAddress(network, trade.from_token_address, token);
    if (!bought && !sold) return [];
    const amount = Number(bought ? trade.to_token_amount : trade.from_token_amount);
    const price = Number(bought ? trade.price_to_in_usd : trade.price_from_in_usd);
    const usd = Number(trade.volume_in_usd);
    const at = Date.parse(String(trade.block_timestamp));
    if (typeof trade.tx_hash !== "string" || typeof trade.tx_from_address !== "string" || !Number.isFinite(at) || !(amount > 0)) return [];
    return [
      {
        tx: trade.tx_hash,
        at,
        trader: trade.tx_from_address,
        side: bought ? "buy" : "sell",
        amount,
        usd: Number.isFinite(usd) ? usd : amount * (Number.isFinite(price) ? price : 0),
        price: Number.isFinite(price) ? price : 0,
      },
    ];
  });
}

export interface TokenHolder {
  /** The wallet (token account owner), or the token account when the owner is unknown. */
  owner: string;
  amount: number;
  /** Share of the supply, percent. */
  pct: number;
}

/**
 * Largest token accounts (`getTokenLargestAccounts`, up to 20) with their owners (`getMultipleAccounts` jsonParsed),
 * merged per owner (one wallet can hold several accounts) and sorted by amount.
 */
export function readLargestHolders(
  largest: Array<{ address: string; uiAmount: number | null }>,
  owners: Record<string, string | undefined>,
  supply: number,
): TokenHolder[] {
  const byOwner = new Map<string, number>();
  for (const account of largest) {
    const amount = account.uiAmount ?? 0;
    if (!(amount > 0)) continue;
    const owner = owners[account.address] ?? account.address;
    byOwner.set(owner, (byOwner.get(owner) ?? 0) + amount);
  }
  return [...byOwner.entries()]
    .map(([owner, amount]) => ({ owner, amount, pct: supply > 0 ? (amount / supply) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

export const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/** "28s", "5m", "3h", "2d" ago. */
export function ago(at: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
