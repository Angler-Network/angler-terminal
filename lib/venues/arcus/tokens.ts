/** Arcus router token list (`GET /v1/tokens`) parsing and symbol matching. Pure, unit-tested. */

export interface ArcusToken {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  category: string;
}

/** Real-world assets news can trade; meme and leveraged pToken listings are skipped. */
const TRADABLE_CATEGORIES = new Set(["stock", "index", "commodity"]);

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function readArcusTokens(body: unknown): ArcusToken[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (!isAddress(record.address) || typeof record.symbol !== "string" || !Number.isInteger(record.decimals)) return [];
    if (record.verified === false) return [];
    return [
      {
        address: record.address,
        symbol: record.symbol,
        name: typeof record.name === "string" ? record.name : record.symbol,
        decimals: record.decimals as number,
        category: typeof record.category === "string" ? record.category : "",
      },
    ];
  });
}

/** The stock/index/commodity token for a terminal symbol (e.g. "NVDA"), or null when Arcus doesn't list it. */
export function findArcusToken(tokens: ArcusToken[], symbol: string): ArcusToken | null {
  const wanted = symbol.toUpperCase();
  return tokens.find((token) => TRADABLE_CATEGORIES.has(token.category) && token.symbol.toUpperCase() === wanted) ?? null;
}

/** The stablecoin trades are sized in (USDG, or mUSDG on testnet). */
export function findQuoteToken(tokens: ArcusToken[], quoteSymbol: string): ArcusToken | null {
  return tokens.find((token) => token.symbol === quoteSymbol) ?? null;
}
