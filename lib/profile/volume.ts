import { isAnglerClientIndex } from "@/lib/venues/lighter/pricing";

/**
 * Volume that went through this terminal, read from the venues' own records so the browser can't inflate it:
 * - Hyperliquid fills whose builder fee matches ours (other apps' builder codes charge other rates),
 * - Lighter trades where the wallet's side carries the terminal's client order tag,
 * - Solana swaps whose transaction pays our Jupiter referral or Titan fee account.
 */

/** A Hyperliquid fill from `userFillsByTime` (only the fields used here). */
export interface HlFill {
  px: string;
  sz: string;
  time: number;
  tid: number;
  builderFee?: string;
}

/**
 * Whether a fill paid our builder fee at one of the VIP tiers (`fees`, in tenths of a basis point like `builder.f`), so
 * the fee is notional × fee / 100,000. Allows the cent-ish precision fills report and ±4% for rounding: the tiers
 * sit 7% or more apart.
 */
export function isAnglerFill(fill: HlFill, fees: number | number[]) {
  const rates = (Array.isArray(fees) ? fees : [fees]).filter((fee) => fee > 0);
  if (rates.length === 0 || fill.builderFee === undefined) return false;
  const paid = Number(fill.builderFee);
  const notional = Math.abs(Number(fill.px) * Number(fill.sz));
  if (!(paid > 0) || !(notional > 0)) return false;
  return rates.some((fee) => {
    const expected = (notional * fee) / 100_000;
    return Math.abs(paid - expected) <= Math.max(expected * 0.04, 0.000002);
  });
}

/** Our volume in a batch of fills, the builder fees they paid us, and the newest fill time seen (the next sync starts after it). */
export function hlAnglerVolume(fills: HlFill[], builderFeeTenthsBp: number | number[]) {
  let usd = 0;
  let fee = 0;
  let lastTime = 0;
  for (const fill of fills) {
    lastTime = Math.max(lastTime, fill.time);
    if (!isAnglerFill(fill, builderFeeTenthsBp)) continue;
    usd += Math.abs(Number(fill.px) * Number(fill.sz));
    fee += Number(fill.builderFee) || 0;
  }
  return { usd, fee, lastTime };
}

/** A Lighter trade from `/api/v1/trades` (only the fields used here). */
export interface LighterTrade {
  trade_id: number;
  usd_amount: string;
  timestamp: number;
  ask_account_id: number;
  bid_account_id: number;
  ask_client_id: number;
  bid_client_id: number;
}

/** Whether the account's own side of the trade was placed from this terminal. */
export function isAnglerTrade(trade: LighterTrade, accountIndex: number) {
  return (
    (trade.ask_account_id === accountIndex && isAnglerClientIndex(trade.ask_client_id)) ||
    (trade.bid_account_id === accountIndex && isAnglerClientIndex(trade.bid_client_id))
  );
}

export function lighterAnglerVolume(trades: LighterTrade[], accountIndex: number) {
  let usd = 0;
  let lastTime = 0;
  for (const trade of trades) {
    lastTime = Math.max(lastTime, trade.timestamp);
    if (isAnglerTrade(trade, accountIndex)) usd += Math.abs(Number(trade.usd_amount)) || 0;
  }
  return { usd, lastTime };
}

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

/** The parts of a `getTransaction` (jsonParsed) answer the check reads. */
export interface ParsedSolanaTx {
  meta: { err: unknown; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null;
  transaction: { message: { accountKeys: Array<{ pubkey: string; signer: boolean }> } };
}

/**
 * A swap that paid us: it succeeded, `feeAccounts` (our fee token accounts) appear in it or a `feeOwners` wallet's
 * token balance grew, and the volume is the signer's USDC change. Null when it isn't one.
 */
export function readAnglerSwap(tx: ParsedSolanaTx, proof: { feeAccounts: Set<string>; feeOwners: Set<string> }, usdcMint: string) {
  if (!tx.meta || tx.meta.err !== null) return null;
  const keys = tx.transaction.message.accountKeys;
  const signer = keys[0]?.signer ? keys[0].pubkey : null;
  if (!signer) return null;
  const pre = tx.meta.preTokenBalances ?? [];
  const post = tx.meta.postTokenBalances ?? [];
  const amount = (list: TokenBalance[], index: number) => BigInt(list.find((entry) => entry.accountIndex === index)?.uiTokenAmount.amount ?? "0");
  const paidByAccount = keys.some((key) => proof.feeAccounts.has(key.pubkey));
  const paidToOwner = post.some((entry) => entry.owner !== undefined && proof.feeOwners.has(entry.owner) && amount(post, entry.accountIndex) > amount(pre, entry.accountIndex));
  if (!paidByAccount && !paidToOwner) return null;
  // The signer's USDC accounts, before and after.
  const indexes = new Set([...pre, ...post].filter((entry) => entry.owner === signer && entry.mint === usdcMint).map((entry) => entry.accountIndex));
  let change = BigInt(0);
  let decimals = 6;
  for (const index of indexes) {
    change += amount(post, index) - amount(pre, index);
    decimals = [...pre, ...post].find((entry) => entry.accountIndex === index)?.uiTokenAmount.decimals ?? decimals;
  }
  const usd = Math.abs(Number(change)) / 10 ** decimals;
  return usd > 0 ? { signer, usd } : null;
}
