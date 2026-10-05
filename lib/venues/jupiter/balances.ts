import { WSOL_MINT } from "./config";

/** jsonParsed token account as returned by getTokenAccountsByOwner. */
interface ParsedTokenAccount {
  account: { data: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } };
}

export function sumTokenAccounts(accounts: ParsedTokenAccount[]) {
  return accounts.reduce((sum, entry) => {
    const amount = entry.account.data.parsed?.info?.tokenAmount?.amount;
    return amount && /^\d+$/.test(amount) ? sum + BigInt(amount) : sum;
  }, 0n);
}

/** Jupiter swaps native SOL directly, so a SOL "balance" is native lamports plus any wrapped SOL. */
export function spendableBalance(mint: string, tokens: Record<string, bigint>, lamports: bigint) {
  const held = tokens[mint] ?? 0n;
  return mint === WSOL_MINT ? held + lamports : held;
}
