/** Polymarket builder trades, as the profile sync reads them (pure, unit-tested). */

export interface BuilderTradeRow {
  id: string;
  /** The Deposit Wallet that placed the order, lowercase. */
  maker: string;
  usd: number;
  /** Match time, unix seconds. */
  time: number;
}

/**
 * Rows from `/builder/trades`: settled or settling trades with a maker, a USDC size and a match time that paid our
 * builder fee (`builderFee` above zero: before the fee is set, or on a fee-free order, a trade earns nothing).
 */
export function readPolymarketBuilderTrades(data: unknown[]): BuilderTradeRow[] {
  return data.flatMap((entry) => {
    const trade = entry as { id?: unknown; maker?: unknown; sizeUsdc?: unknown; matchTime?: unknown; status?: unknown; builderFee?: unknown };
    const usd = Number(trade.sizeUsdc);
    const time = Number(trade.matchTime);
    if (typeof trade.maker !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(trade.maker) || !(usd > 0) || !(time > 0)) return [];
    if (!(Number(trade.builderFee) > 0)) return [];
    if (typeof trade.status === "string" && /FAILED/i.test(trade.status)) return [];
    return [{ id: String(trade.id ?? ""), maker: trade.maker.toLowerCase(), usd, time }];
  });
}

/** Volume of `wallets`' trades after `cursor` (seconds), the part in the closed beta, and the newest time counted. */
export function polymarketAnglerVolume(rows: BuilderTradeRow[], wallets: Set<string>, cursor: number | null, inBeta: (time: number) => boolean) {
  let usd = 0;
  let betaUsd = 0;
  let lastTime = cursor ?? 0;
  const seen = new Set<string>();
  for (const row of rows) {
    if (!wallets.has(row.maker) || row.time <= (cursor ?? 0) || (row.id && seen.has(row.id))) continue;
    if (row.id) seen.add(row.id);
    usd += row.usd;
    if (inBeta(row.time * 1000)) betaUsd += row.usd;
    lastTime = Math.max(lastTime, row.time);
  }
  return { usd: Math.round(usd * 100) / 100, betaUsd: Math.round(betaUsd * 100) / 100, lastTime };
}
