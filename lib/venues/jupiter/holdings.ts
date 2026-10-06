import { fromBaseUnits } from "./amounts";
import { WSOL_MINT } from "./config";
import type { JupTokenRecord } from "./tokens";

/** One token in a Solana wallet, valued with Jupiter's USD price. */
export interface SpotHolding {
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  amount: number;
  usdPrice: number | null;
  usd: number | null;
  verified: boolean;
}

export interface SpotHoldings {
  holdings: SpotHolding[];
  /** Unverified tokens without a price (airdrop spam, mostly): counted, not listed. */
  hidden: number;
}

/** jsonParsed token account from getTokenAccountsByOwner. */
export interface ParsedTokenAccount {
  account: { data: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } } };
}

/** Raw amounts per mint across all of a wallet's token accounts (both token programs), zero balances dropped. */
export function rawAmountsByMint(accounts: ParsedTokenAccount[]) {
  const amounts = new Map<string, bigint>();
  for (const entry of accounts) {
    const info = entry.account.data.parsed?.info;
    const amount = info?.tokenAmount?.amount;
    if (!info?.mint || !amount || !/^\d+$/.test(amount) || amount === "0") continue;
    amounts.set(info.mint, (amounts.get(info.mint) ?? 0n) + BigInt(amount));
  }
  return amounts;
}

/**
 * Values each mint with its Jupiter record; native SOL joins wrapped SOL. Tokens Jupiter doesn't know, and unverified
 * ones without a price, are hidden (counted). Largest value first.
 */
export function buildHoldings(amounts: Map<string, bigint>, lamports: bigint, records: JupTokenRecord[]): SpotHoldings {
  const byMint = new Map(records.map((record) => [record.id, record]));
  const raw = new Map(amounts);
  if (lamports > 0n) raw.set(WSOL_MINT, (raw.get(WSOL_MINT) ?? 0n) + lamports);
  const holdings: SpotHolding[] = [];
  let hidden = 0;
  for (const [mint, value] of raw) {
    const record = byMint.get(mint);
    const decimals = mint === WSOL_MINT ? 9 : record?.decimals;
    const price = typeof record?.usdPrice === "number" && record.usdPrice > 0 ? record.usdPrice : null;
    if (!record || decimals === undefined || !Number.isInteger(decimals) || (!record.isVerified && price === null)) {
      hidden += 1;
      continue;
    }
    const amount = fromBaseUnits(value, decimals);
    holdings.push({
      mint,
      symbol: mint === WSOL_MINT ? "SOL" : (record.symbol ?? mint.slice(0, 4)),
      name: mint === WSOL_MINT ? "Solana" : (record.name ?? ""),
      icon: record.icon ?? null,
      amount,
      usdPrice: price,
      usd: price === null ? null : amount * price,
      verified: Boolean(record.isVerified),
    });
  }
  holdings.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  return { holdings, hidden };
}

export function holdingsValue(holdings: SpotHolding[]) {
  return holdings.reduce((sum, holding) => sum + (holding.usd ?? 0), 0);
}
