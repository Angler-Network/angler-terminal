"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { useSelectedAsset } from "@/components/terminal/selected-asset";
import { useTrading } from "@/components/terminal/trading-provider";
import { useFunding } from "@/components/terminal/use-funding";
import { formatPrice } from "@/lib/format";
import { FUNDING_VENUES, bestFundingArb, fundingApr, type FundingArb, type FundingVenue } from "@/lib/trading/funding";
import type { VenueMarket } from "@/lib/venues/types";
import { FundingArbDialog } from "./funding-arb-dialog";

const VENUE_LABELS: Record<FundingVenue, string> = { hyperliquid: "Hyperliquid", lighter: "Lighter", binance: "Binance", bybit: "Bybit" };

type SortKey = "arb" | "symbol" | FundingVenue;

interface Row {
  symbol: string;
  kind: VenueMarket["kind"];
  hyperliquid?: VenueMarket;
  lighter?: VenueMarket;
  rates: Partial<Record<FundingVenue, number>>;
  arb: FundingArb | null;
}

function Apr({ rate }: { rate: number | undefined }) {
  if (rate === undefined) return <span className="text-app-faint">—</span>;
  const apr = fundingApr(rate);
  return (
    <span className={apr >= 0 ? "text-app-up" : "text-app-down"} title={`${(rate * 100).toFixed(4)}% per 8h`}>
      {apr >= 0 ? "+" : ""}
      {apr.toFixed(2)}%
    </span>
  );
}

/**
 * Every asset the terminal can trade, with mainnet funding on each venue and the funding spread between the venues
 * we trade (long where funding is lowest, short where it's highest).
 */
export function MarketsTable() {
  const router = useRouter();
  const { selectAsset } = useSelectedAsset();
  const { marketsByVenue } = useTrading();
  const funding = useFunding();
  const [query, setQuery] = useState("");
  const [bothOnly, setBothOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("arb");
  const [arbRow, setArbRow] = useState<Row | null>(null);

  const rows = useMemo(() => {
    const bySymbol = new Map<string, Row>();
    for (const venue of ["hyperliquid", "lighter"] as const) {
      for (const market of marketsByVenue[venue] ?? []) {
        // Hyperliquid can list a symbol on several dexes; the main dex wins.
        const row = bySymbol.get(market.symbol) ?? { symbol: market.symbol, kind: market.kind, rates: {}, arb: null };
        if (!row[venue] || market.dex === "") row[venue] = market;
        bySymbol.set(market.symbol, row);
      }
    }
    for (const row of bySymbol.values()) {
      row.rates = funding?.[row.symbol] ?? {};
      // A spread is only actionable when both venues we trade list the asset.
      row.arb = row.hyperliquid && row.lighter ? bestFundingArb(row.rates) : null;
    }
    return [...bySymbol.values()];
  }, [marketsByVenue, funding]);

  const shown = useMemo(() => {
    const wanted = query.trim().toUpperCase();
    const filtered = rows.filter((row) => (!wanted || row.symbol.includes(wanted)) && (!bothOnly || (row.hyperliquid && row.lighter)));
    const value = (row: Row) => (sort === "arb" ? (row.arb?.apr ?? -Infinity) : sort === "symbol" ? 0 : (row.rates[sort] ?? -Infinity));
    return filtered.sort((a, b) => (sort === "symbol" ? a.symbol.localeCompare(b.symbol) : value(b) - value(a)));
  }, [rows, query, bothOnly, sort]);

  const open = (symbol: string) => {
    selectAsset(symbol);
    router.push("/");
  };

  const header = (key: SortKey, label: string, title?: string) => (
    <th className="px-3 py-2 text-right first:text-left">
      <button
        type="button"
        onClick={() => setSort(key)}
        title={title}
        className={`text-[11px] font-medium uppercase tracking-[0.06em] ${sort === key ? "text-app-ink" : "text-app-faint hover:text-app-ink"}`}
      >
        {label}
        {sort === key && " ↓"}
      </button>
    </th>
  );

  return (
    <section className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-app-hairline px-4 py-3">
        <div>
          <h1 className="text-[16px] font-semibold text-app-ink">Markets</h1>
          <p className="text-[12px] text-app-muted">
            Funding on every venue (mainnet, 8-hour rates annualized; positive means longs pay shorts) and the spread between
            Hyperliquid and Lighter.
          </p>
        </div>
        <label className="ml-auto flex h-9 items-center gap-2 rounded-xl border border-app-field-border bg-app-field px-3">
          <Search className="size-4 text-app-faint" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search, e.g. BTC"
            aria-label="Search markets"
            className="w-40 bg-transparent text-[13px] text-app-ink outline-none placeholder:text-app-faint"
          />
        </label>
        <label className="flex items-center gap-2 text-[12px] text-app-muted">
          <input type="checkbox" checked={bothOnly} onChange={(event) => setBothOnly(event.target.checked)} className="accent-[rgb(var(--app-accent))]" />
          On both venues
        </label>
      </header>
      <div className="scrollbar-subtle min-h-0 flex-1 overflow-auto">
        <table className="w-full text-[12px] tabular-nums">
          <thead className="sticky top-0 z-10 bg-app-card">
            <tr>
              {header("symbol", "Asset")}
              <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-[0.06em] text-app-faint">Price</th>
              {FUNDING_VENUES.map((venue) => header(venue, VENUE_LABELS[venue], `Sort by ${VENUE_LABELS[venue]} funding`))}
              {header("arb", "Funding spread", "Long the lowest-funding venue, short the highest (Hyperliquid and Lighter)")}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const price = row.hyperliquid?.markPx ?? row.lighter?.markPx;
              return (
                <tr key={row.symbol} className="border-t border-app-hairline hover:bg-app-chip/40">
                  <td className="px-3 py-1.5">
                    <button type="button" onClick={() => open(row.symbol)} className="inline-flex items-center gap-2 font-semibold text-app-ink hover:underline">
                      <MarketIcon symbol={row.symbol} kind={row.kind} size={20} />
                      {row.symbol}
                      <span className="flex gap-1">
                        {row.hyperliquid && <span className="rounded bg-app-chip px-1 text-[9px] font-semibold uppercase text-app-muted">HL</span>}
                        {row.lighter && <span className="rounded bg-app-chip px-1 text-[9px] font-semibold uppercase text-app-muted">Lighter</span>}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-1.5 text-right text-app-ink">{price ? formatPrice(price) : "—"}</td>
                  {FUNDING_VENUES.map((venue) => (
                    <td key={venue} className="px-3 py-1.5 text-right">
                      <Apr rate={row.rates[venue]} />
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right">
                    {row.arb ? (
                      <span title={`Long on ${VENUE_LABELS[row.arb.longVenue]}, short on ${VENUE_LABELS[row.arb.shortVenue]}`}>
                        <span className="font-semibold text-app-ink">{row.arb.apr.toFixed(2)}%</span>
                        <span className="ml-1.5 text-app-faint">
                          L {VENUE_LABELS[row.arb.longVenue]} · S {VENUE_LABELS[row.arb.shortVenue]}
                        </span>
                      </span>
                    ) : (
                      <span className="text-app-faint">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {row.arb && (
                      <button
                        type="button"
                        onClick={() => setArbRow(row)}
                        title="Open a long and a short together to collect the funding spread"
                        className="mr-1.5 h-7 rounded-md border border-app-accent/50 px-2.5 text-[12px] font-semibold text-app-accent hover:bg-app-accent/10"
                      >
                        Arb
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => open(row.symbol)}
                      className="h-7 rounded-md border border-app-hairline-strong bg-app-chip px-2.5 text-[12px] font-semibold text-app-ink hover:bg-app-card"
                    >
                      Trade
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="p-6 text-center text-[12px] text-app-muted">{rows.length === 0 ? "Loading markets…" : "No market matches."}</p>}
      </div>
      {arbRow?.arb && arbRow.hyperliquid && arbRow.lighter && (
        <FundingArbDialog
          symbol={arbRow.symbol}
          arb={arbRow.arb}
          markets={{ hyperliquid: arbRow.hyperliquid, lighter: arbRow.lighter }}
          onClose={() => setArbRow(null)}
        />
      )}
    </section>
  );
}
