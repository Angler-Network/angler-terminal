/**
 * Swaps made through the terminal, kept in the browser per wallet (localStorage), for "Your trades" and the holdings'
 * PnL: the chain's own history would need a paid indexer (Birdeye, Helius). Pure, unit-tested; storage lives in the
 * caller.
 */

export const SWAP_CHAINS = ["solana", "robinhood", "ethereum", "base", "arbitrum", "bsc", "hyperevm", "polygon", "optimism", "avalanche", "unichain", "monad", "linea", "sonic", "berachain", "plasma", "ronin", "megaeth", "etherlink", "mantle", "ink", "cronos", "gnosis", "worldchain", "celo", "zksync", "katana", "immutable", "rootstock", "pharos", "blast"] as const;
export type SwapChain = (typeof SWAP_CHAINS)[number];

export interface SwapRecord {
  tx: string;
  /** Unix ms. */
  at: number;
  /** Solana, Robinhood Chain, or an EVM swap chain (`EvmSwapChainKey`). */
  chain: SwapChain;
  /** Mint or token address of the traded token (not the stablecoin side). */
  token: string;
  symbol: string;
  side: "buy" | "sell";
  /** Token amount. */
  amount: number;
  /** Dollar value of the other side. */
  usd: number;
}

export const SWAP_HISTORY_LIMIT = 500;

export function swapHistoryKey(wallet: string) {
  return `angler-terminal:swaps:${wallet}`;
}

function isRecord(value: unknown): value is SwapRecord {
  const record = value as Partial<SwapRecord> | null;
  return (
    !!record &&
    typeof record.tx === "string" &&
    typeof record.at === "number" &&
    SWAP_CHAINS.includes(record.chain as SwapChain) &&
    typeof record.token === "string" &&
    typeof record.symbol === "string" &&
    (record.side === "buy" || record.side === "sell") &&
    typeof record.amount === "number" &&
    record.amount > 0 &&
    typeof record.usd === "number" &&
    record.usd >= 0
  );
}

/** Stored JSON → valid records, newest first. */
export function readSwapHistory(json: string | null): SwapRecord[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isRecord).sort((a, b) => b.at - a.at) : [];
  } catch {
    return [];
  }
}

/** Adds a swap once (by transaction), newest first, keeping the last `SWAP_HISTORY_LIMIT`. */
export function addSwap(history: SwapRecord[], record: SwapRecord) {
  return [record, ...history.filter((entry) => entry.tx !== record.tx)].sort((a, b) => b.at - a.at).slice(0, SWAP_HISTORY_LIMIT);
}

export interface CostBasis {
  /** Tokens bought through the terminal and still held by that account (average-cost method). */
  amount: number;
  /** What those tokens cost, USD. */
  cost: number;
  /** Realized profit from sells, USD. */
  realized: number;
}

/** Average-cost basis of one token from the recorded swaps, oldest first. */
export function costBasis(history: SwapRecord[], token: string): CostBasis {
  let amount = 0;
  let cost = 0;
  let realized = 0;
  for (const record of [...history].filter((entry) => entry.token === token).sort((a, b) => a.at - b.at)) {
    if (record.side === "buy") {
      amount += record.amount;
      cost += record.usd;
      continue;
    }
    // Sells beyond what was bought here came from elsewhere: only the known part has a cost.
    const sold = Math.min(record.amount, amount);
    if (sold <= 0) continue;
    const average = cost / amount;
    realized += record.usd * (sold / record.amount) - average * sold;
    amount -= sold;
    cost -= average * sold;
  }
  return { amount, cost, realized };
}

/**
 * Unrealized PnL of a holding against the recorded cost: only the part bought through the terminal has a known cost,
 * so it is valued on min(held, bought here). Null when nothing was bought here.
 */
export function unrealizedPnl(basis: CostBasis, held: number, price: number | null) {
  if (!(basis.amount > 0) || price === null) return null;
  const known = Math.min(held, basis.amount);
  const average = basis.cost / basis.amount;
  const pnl = known * (price - average);
  return { pnl, pct: average > 0 ? (price / average - 1) * 100 : 0, average, partial: held > basis.amount * 1.0001 };
}
