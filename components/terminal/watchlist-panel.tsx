"use client";

import { ArrowDownUp, Search, Star } from "lucide-react";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useSpotHoldings } from "@/components/portfolio/use-spot-holdings";
import { formatPrice } from "@/lib/format";
import { assetSymbolOf } from "@/lib/spot/listings";
import { terminalKindOf } from "@/lib/terminal-kind";
import { formatUsdCompact } from "@/lib/trading/market-stats";
import { toggleWatch } from "@/lib/watchlist";
import { Change, TokenIcon, usePerpRows, useSpotRows, type MarketRow } from "./market-rows";
import { useSelectedAsset } from "./selected-asset";
import { useTrading } from "./trading-provider";

type Tab = "all" | "yours" | "starred";
type Sort = "volume" | "change";

const panelClass =
  "surface-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55 shadow-[0_1px_2px_rgba(19,35,58,0.05)]";

/** What "Yours" lists: perp positions on /perp, the Solana wallet's tokens on /spot. */
function useYourRows(isSpot: boolean, rows: MarketRow[]): { rows: MarketRow[]; empty: string } {
  const { account } = useTrading();
  const spot = useSpotHoldings();
  return useMemo(() => {
    if (!isSpot) {
      const held = new Set((account?.positions ?? []).map((position) => position.symbol));
      return { rows: rows.filter((row) => held.has(row.symbol)), empty: account ? "No open positions." : "Connect a wallet to see your positions." };
    }
    if (!spot.address) return { rows: [], empty: "Connect a Solana wallet to see your tokens." };
    const holdings = (spot.data?.holdings ?? []).flatMap((holding): MarketRow[] => {
      const asset = assetSymbolOf({ symbol: holding.symbol, name: holding.name, category: "crypto" });
      if (!asset) return [];
      const listed = rows.find((row) => row.mint === holding.mint);
      const id = `jupiter:${holding.mint}`;
      return [
        {
          ...(listed ?? {
            id,
            symbol: holding.symbol,
            name: holding.name,
            asset,
            mint: holding.mint,
            icon: holding.icon ?? undefined,
            kind: "crypto",
            category: "crypto",
            price: holding.usdPrice ?? undefined,
            venues: ["Jupiter"],
            verified: holding.verified,
            watch: { id, kind: "spot", symbol: holding.symbol, asset, name: holding.name, icon: holding.icon ?? undefined, mint: holding.mint },
          }),
          // The sub line shows what the wallet holds instead of the market's volume.
          volume24h: holding.usd ?? undefined,
        },
      ];
    });
    return { rows: holdings, empty: spot.loading ? "Loading your tokens…" : "No tokens in this wallet." };
  }, [isSpot, account, rows, spot.address, spot.data, spot.loading]);
}

/**
 * The optional markets column left of the chart (`panels.watchlist`): every market of the current view, the ones you
 * hold (perp positions or Solana tokens) and the ones starred in the market search, with a filter and two sorts.
 * A row selects its asset, like the search does.
 */
export function WatchlistPanel() {
  const isSpot = terminalKindOf(usePathname()) === "spot";
  const { preferences, updatePreference } = usePreferences();
  const { symbol, selectAsset } = useSelectedAsset();
  const [tab, setTab] = useState<Tab>("starred");
  const [sort, setSort] = useState<Sort>("volume");
  const [query, setQuery] = useState("");

  const perpRows = usePerpRows(!isSpot);
  const { rows: spotRows } = useSpotRows(isSpot);
  const all = useMemo(() => (isSpot ? spotRows : perpRows) ?? [], [isSpot, spotRows, perpRows]);
  const yours = useYourRows(isSpot, all);
  const kind = isSpot ? "spot" : "perp";
  const starred = useMemo(
    () =>
      preferences.watchlist
        .filter((entry) => entry.kind === kind)
        .map(
          (entry): MarketRow =>
            all.find((row) => row.id === entry.id) ?? {
              id: entry.id,
              symbol: entry.symbol,
              name: entry.name ?? entry.symbol,
              asset: entry.asset,
              mint: entry.mint,
              icon: entry.icon,
              kind: "crypto",
              category: "crypto",
              venues: [],
              verified: true,
              watch: entry,
            },
        ),
    [preferences.watchlist, kind, all],
  );

  const rows = useMemo(() => {
    const source = tab === "all" ? all : tab === "yours" ? yours.rows : starred;
    const wanted = query.trim().toUpperCase();
    const filtered = wanted ? source.filter((row) => row.symbol.toUpperCase().includes(wanted) || row.name.toUpperCase().includes(wanted)) : source;
    if (tab === "starred" && sort === "volume") return filtered;
    return [...filtered].sort((a, b) => (sort === "change" ? (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity) : (b.volume24h ?? 0) - (a.volume24h ?? 0)));
  }, [tab, all, yours.rows, starred, query, sort]);

  const loading = tab === "all" && (isSpot ? spotRows : perpRows) === null;
  const empty =
    tab === "yours" ? yours.empty : tab === "starred" ? "Star markets in the search (Ctrl K) to keep them here." : query ? "No market matches." : "No markets.";

  return (
    <section aria-label="Watchlist" className={panelClass}>
      <header className="flex shrink-0 items-center gap-1.5 border-b border-app-hairline px-2.5 py-2">
        <div role="tablist" aria-label="Watchlist view" className="flex flex-1 gap-0.5 rounded-lg bg-app-chip p-0.5">
          {(
            [
              ["all", "All"],
              ["yours", "Yours"],
              ["starred", "Starred"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`h-7 flex-1 rounded-md text-[12px] font-semibold transition-colors ${tab === value ? "bg-app-card text-app-ink shadow-xs" : "text-app-muted hover:text-app-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSort(sort === "volume" ? "change" : "volume")}
          title={sort === "volume" ? `Sorted by ${tab === "yours" && isSpot ? "value" : "24h volume"}. Sort by 24h change` : "Sorted by 24h change. Sort by volume"}
          aria-label="Change sort"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-app-muted transition-colors hover:bg-app-chip hover:text-app-ink"
        >
          <ArrowDownUp className="size-4" />
        </button>
      </header>
      <label className="mx-2.5 mt-2 flex h-8 shrink-0 items-center gap-2 rounded-lg border border-app-hairline bg-app-field px-2.5">
        <Search className="size-3.5 shrink-0 text-app-faint" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          aria-label="Filter the watchlist"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-app-ink outline-hidden placeholder:text-app-faint"
        />
      </label>
      <ul className="scrollbar-subtle mt-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {loading ? (
          <li className="px-3 py-6 text-center text-[12px] text-app-muted">Loading markets…</li>
        ) : rows.length === 0 ? (
          <li className="px-3 py-6 text-center text-[12px] leading-snug text-app-muted">{empty}</li>
        ) : (
          rows.map((row) => {
            const active = row.asset === symbol;
            const watched = preferences.watchlist.some((entry) => entry.id === row.id);
            return (
              <li key={row.id} className={`group flex items-center rounded-lg pr-2 transition-colors ${active ? "bg-app-chip" : "hover:bg-app-chip/60"}`}>
                <button
                  type="button"
                  aria-current={active || undefined}
                  onClick={() => selectAsset(row.asset, row.mint)}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 pr-1.5 text-left tabular-nums"
                >
                  <TokenIcon row={row} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-app-ink">{row.symbol}</span>
                    <span className="block truncate text-[10px] text-app-faint">
                      {tab === "yours" && isSpot ? "Value" : "Vol"} {formatUsdCompact(row.volume24h)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[12px] text-app-ink">{row.price !== undefined ? formatPrice(row.price) : "—"}</span>
                    <span className="block text-[10px]">
                      <Change value={row.change24h} />
                    </span>
                  </span>
                </button>
                <button
                    type="button"
                    aria-label={watched ? `Unstar ${row.symbol}` : `Star ${row.symbol}`}
                    aria-pressed={watched}
                    onClick={(event) => {
                      event.stopPropagation();
                      updatePreference("watchlist", toggleWatch(preferences.watchlist, row.watch));
                    }}
                    className={`shrink-0 ${watched ? "text-[#f5c97b]" : "text-app-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
                  >
                  <Star className="size-3.5" fill={watched ? "currentColor" : "none"} />
                </button>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
