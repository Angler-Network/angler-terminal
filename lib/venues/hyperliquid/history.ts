import { hlPnlSeries, type HlFill, type HlFundingEntry, type PnlPoint } from "@/lib/trading/portfolio-history";
import { infoClient } from "./clients";

export interface HlHistory {
  pnl: PnlPoint[];
  fills: HlFill[];
  funding: HlFundingEntry[];
  /** userFillsByTime returns at most 2000 fills; older ones in the window are missing when it's full. */
  truncated: boolean;
}

const MAX_FILLS = 2000;

/** Spot fills ("@107", "PURR/USDC") aren't part of the perp portfolio. */
const isPerpCoin = (coin: string) => !coin.startsWith("@") && !coin.includes("/");

/**
 * The user's perp PnL, fills and funding since `since` (at most 30 days back: the `perpMonth` portfolio window).
 * Called from the browser, so it spends the user's own rate limit.
 */
export async function hlHistory(user: `0x${string}`, since: number): Promise<HlHistory> {
  const info = await infoClient();
  const [portfolio, fills, funding] = await Promise.all([
    info.portfolio({ user }),
    info.userFillsByTime({ user, startTime: since, aggregateByTime: true }).catch(() => []),
    info.userFunding({ user, startTime: since }).catch(() => []),
  ]);
  const month = portfolio.find(([period]) => period === "perpMonth") ?? portfolio.find(([period]) => period === "month");
  return {
    // The whole month: the page measures its range from the value at the range start (`rebase`).
    pnl: hlPnlSeries(month?.[1].pnlHistory ?? [], 0),
    fills: (fills as HlFill[]).filter((fill) => isPerpCoin(fill.coin)),
    truncated: fills.length >= MAX_FILLS,
    funding: funding as HlFundingEntry[],
  };
}
