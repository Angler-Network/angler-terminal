import { cookies } from "next/headers";
import { InitialQuoteProvider } from "@/components/chart/initial-quote";
import { TerminalShell } from "@/components/terminal/terminal-shell";
import { CHART_COOKIE, chartQuote, DEFAULT_CHART_SETTINGS, parseChartCookie } from "@/lib/markets/model";
import { getMarkets } from "@/lib/markets/server";

/**
 * Shared by /perp and /spot (`lib/terminal-kind.ts`): the shell lives in the layout, so switching views keeps the
 * chart, books and news feed mounted. The pages only add their title.
 */
export default async function TerminalLayout({ children }: { children: React.ReactNode }) {
  const chart = parseChartCookie((await cookies()).get(CHART_COOKIE)?.value) ?? DEFAULT_CHART_SETTINGS;
  // Not awaited: the page streams at once and the price follows from the same cached market list as the tape. Only
  // this one quote goes into the HTML.
  const quote = getMarkets(chart.market)
    .then((markets) => chartQuote(markets, chart))
    .catch(() => null);
  return (
    <>
      {children}
      <InitialQuoteProvider quote={quote}>
        <TerminalShell />
      </InitialQuoteProvider>
    </>
  );
}
