"use client";

import { Search, Star, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useModalEnter } from "@/components/app/use-motion";
import { formatPrice } from "@/lib/format";
import { MARKET_CATEGORIES, type MarketCategory } from "@/lib/markets/category";
import { terminalKindOf, type TerminalKind } from "@/lib/terminal-kind";
import { formatUsdCompact } from "@/lib/trading/market-stats";
import { isWatched, toggleWatch } from "@/lib/watchlist";
import { Change, TokenIcon, usePerpRows, useSpotRows, type MarketRow } from "./market-rows";
import { useSelectedAsset } from "./selected-asset";

interface AssetSearchValue {
  open: () => void;
}

const AssetSearchContext = createContext<AssetSearchValue | null>(null);

export function useAssetSearch() {
  const context = useContext(AssetSearchContext);
  if (!context) throw new Error("useAssetSearch must be used within AssetSearchProvider");
  return context;
}

type Tab = "favorites" | "all" | MarketCategory;

type SortKey = "name" | "price" | "change" | "volume" | "liquidity";
type SortState = { key: SortKey; dir: "desc" | "asc" } | null;

const sortValue: Record<Exclude<SortKey, "name">, (row: MarketRow) => number | undefined> = {
  price: (row) => row.price,
  change: (row) => row.change24h,
  volume: (row) => row.volume24h,
  liquidity: (row) => row.liquidity,
};

/** Sorts by a column; rows without a figure stay at the bottom either way. */
function sortRows(rows: MarketRow[], sort: SortState) {
  if (!sort) return rows;
  const sign = sort.dir === "desc" ? -1 : 1;
  if (sort.key === "name") return [...rows].sort((a, b) => sign * a.symbol.localeCompare(b.symbol));
  const value = sortValue[sort.key];
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === undefined || right === undefined) return left === undefined ? (right === undefined ? 0 : 1) : -1;
    return sign * (left - right);
  });
}

/** Column header that sorts: high to low, then low to high, then back to the default order. */
function SortHeader({ label, column, sort, onSort, className = "" }: { label: string; column: SortKey; sort: SortState; onSort: (sort: SortState) => void; className?: string }) {
  const active = sort?.key === column;
  const next: SortState = !active ? { key: column, dir: column === "name" ? "asc" : "desc" } : sort.dir === (column === "name" ? "asc" : "desc") ? { key: column, dir: sort.dir === "desc" ? "asc" : "desc" } : null;
  return (
    <span className={className}>
      <button
        type="button"
        onClick={() => onSort(next)}
        aria-label={`${label}${active ? `, sorted ${sort.dir === "desc" ? "high to low" : "low to high"}` : ""}. Sort`}
        className={`inline-flex items-center gap-1 uppercase tracking-[0.06em] transition-colors hover:text-app-ink ${active ? "text-app-ink" : ""}`}
      >
        {label}
        <span aria-hidden className={`text-[9px] ${active ? "" : "opacity-0"}`}>
          {active && sort.dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </span>
  );
}

function AssetSearchDialog({ kind, onClose }: { kind: TerminalKind; onClose: () => void }) {
  const { preferences, updatePreference } = usePreferences();
  const { selectAsset } = useSelectedAsset();
  const backdropRef = useModalEnter(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [sort, setSort] = useState<SortState>(null);
  const [active, setActive] = useState(0);
  const isSpot = kind === "spot";

  const perpRows = usePerpRows(!isSpot);
  const { rows: spotRows, searching } = useSpotRows(isSpot, query);

  const watchlist = preferences.watchlist;
  const rows = useMemo(() => {
    const source = (isSpot ? spotRows : perpRows) ?? [];
    const wanted = query.trim().toUpperCase();
    const watched = new Set(watchlist.map((entry) => entry.id));
    // Favorites the current list doesn't carry (found by a search once) still show, without live numbers.
    const extra: MarketRow[] =
      tab === "favorites"
        ? watchlist
            .filter((entry) => entry.kind === kind && !source.some((row) => row.id === entry.id))
            .map((entry) => ({
              id: entry.id,
              symbol: entry.symbol,
              name: entry.name ?? (entry.kind === "perp" ? "Perpetual" : entry.symbol),
              asset: entry.asset,
              mint: entry.mint,
              icon: entry.icon,
              kind: "crypto",
              category: "crypto",
              venues: [],
              verified: true,
              watch: entry,
            }))
        : [];
    const filtered = [...source, ...extra].filter(
      (row) =>
        (tab === "all" || (tab === "favorites" ? watched.has(row.id) : row.category === tab)) &&
        (!isSpot || !verifiedOnly || row.verified) &&
        (!wanted || row.symbol.toUpperCase().includes(wanted) || row.name.toUpperCase().includes(wanted) || row.mint === query.trim()),
    );
    return sortRows(filtered, sort);
  }, [isSpot, spotRows, perpRows, query, tab, verifiedOnly, watchlist, kind, sort]);

  // Counts follow "Verified only" (the search box narrows the list, not the tabs).
  const counts = useMemo(() => {
    const byCategory: Partial<Record<MarketCategory, number>> = {};
    for (const row of (isSpot ? spotRows : perpRows) ?? []) {
      if (isSpot && verifiedOnly && !row.verified) continue;
      byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
    }
    return byCategory;
  }, [isSpot, spotRows, perpRows, verifiedOnly]);

  useEffect(() => setActive(0), [query, tab, verifiedOnly, sort]);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (row: MarketRow | undefined) => {
    if (!row) return;
    selectAsset(row.asset, row.mint);
    onClose();
  };
  const toggleFavorite = (row: MarketRow | undefined) => row && updatePreference("watchlist", toggleWatch(watchlist, row.watch));

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(rows.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(rows[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      toggleFavorite(rows[active]);
    }
  };

  const loading = (isSpot ? spotRows : perpRows) === null;
  const tabs: Array<{ value: Tab; label: string; count?: number }> = [
    { value: "all", label: "All" },
    ...MARKET_CATEGORIES.filter((category) => counts[category.value]).map((category) => ({ value: category.value as Tab, label: category.label, count: counts[category.value] })),
  ];
  const columns = isSpot ? "grid-cols-[minmax(0,1fr)_96px_80px] md:grid-cols-[minmax(0,1fr)_110px_86px_96px_96px_76px]" : "grid-cols-[minmax(0,1fr)_96px_80px] md:grid-cols-[minmax(0,1fr)_110px_86px_100px_130px]";

  return (
    <div ref={backdropRef} className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 p-3 pt-[8vh] sm:p-6 sm:pt-[10vh]" role="presentation" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isSpot ? "Search spot markets" : "Search perp markets"}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        className="surface-menu flex h-[min(680px,84vh)] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-app-hairline-strong bg-app-dialog text-app-ink shadow-[0_30px_80px_-20px_rgba(3,12,21,0.7)]"
      >
        <div className="flex items-center gap-3 border-b border-app-hairline px-4 py-3">
          <Search className="size-[18px] shrink-0 text-app-muted" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={isSpot ? "Search any spot token by name, ticker or address" : "Search perp markets by ticker"}
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="asset-search-list"
            aria-activedescendant={rows[active] ? `asset-search-${active}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-hidden placeholder:text-app-faint"
          />
          {isSpot && (
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[12px] font-semibold text-app-muted">
              <input type="checkbox" checked={verifiedOnly} onChange={(event) => setVerifiedOnly(event.target.checked)} className="size-3.5 accent-[rgb(var(--app-accent))]" />
              Verified only
            </label>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-app-faint hover:text-app-ink">
            <X className="size-[18px]" />
          </button>
        </div>

        <div role="tablist" aria-label="Category" className="scrollbar-none flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-app-hairline px-4 py-2.5">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "favorites"}
            aria-label="Favorites"
            title="Favorites"
            onClick={() => setTab("favorites")}
            className={`grid size-8 shrink-0 place-items-center rounded-lg transition-colors ${tab === "favorites" ? "bg-app-chip text-[#f5c97b]" : "text-app-muted hover:text-app-ink"}`}
          >
            <Star className="size-4" fill={tab === "favorites" ? "currentColor" : "none"} />
          </button>
          {tabs.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={tab === option.value}
              onClick={() => setTab(option.value)}
              className={`h-8 shrink-0 rounded-lg px-3 text-[12px] font-semibold transition-colors ${
                tab === option.value ? "bg-app-chip text-app-ink" : "text-app-muted hover:text-app-ink"
              }`}
            >
              {option.label}
              {option.count !== undefined && <span className="ml-1.5 text-app-faint">{option.count}</span>}
            </button>
          ))}
        </div>

        <div className={`grid shrink-0 ${columns} gap-3 border-b border-app-hairline px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-faint`}>
          <SortHeader label="Name" column="name" sort={sort} onSort={setSort} />
          <SortHeader label="Price" column="price" sort={sort} onSort={setSort} className="text-right" />
          <SortHeader label="24h" column="change" sort={sort} onSort={setSort} className="text-right" />
          <SortHeader label="24h vol." column="volume" sort={sort} onSort={setSort} className="hidden text-right md:block" />
          {isSpot && <SortHeader label="Liquidity" column="liquidity" sort={sort} onSort={setSort} className="hidden text-right md:block" />}
          <span className="hidden text-right md:block">
            {isSpot ? "Venue" : "Venues"}
          </span>
        </div>

        <div ref={listRef} id="asset-search-list" role="listbox" aria-label="Markets" className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto py-1">
          {loading ? (
            <p className="py-12 text-center text-[13px] text-app-muted">Loading markets…</p>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-[13px] text-app-muted">
              {tab === "favorites" ? "No favorites yet. Star a market to keep it here." : isSpot && searching ? "Searching…" : "No market matches."}
            </p>
          ) : (
            rows.map((row, index) => {
              const watched = isWatched(watchlist, row.id);
              return (
                <div
                  key={row.id}
                  id={`asset-search-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(row)}
                  className={`grid cursor-pointer ${columns} items-center gap-3 px-4 py-2 text-[13px] tabular-nums ${index === active ? "bg-app-chip" : ""}`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    {/* Mouse shortcut only: the row is an option, so it can't hold a button; keyboards use Ctrl+S. */}
                    <span
                      aria-hidden
                      title={watched ? "Remove from favorites (Ctrl S)" : "Add to favorites (Ctrl S)"}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleFavorite(row);
                      }}
                      className={`shrink-0 ${watched ? "text-[#f5c97b]" : "text-app-faint hover:text-app-ink"}`}
                    >
                      <Star className="size-3.5" fill={watched ? "currentColor" : "none"} />
                    </span>
                    <TokenIcon row={row} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-semibold">{row.symbol}</span>
                        {isSpot && !row.verified && <span className="rounded bg-[#f5c97b]/15 px-1 text-[9px] font-semibold uppercase text-[#f5c97b]">Unverified</span>}
                      </span>
                      <span className="block truncate text-[11px] text-app-muted">{row.name}</span>
                    </span>
                  </span>
                  <span className="text-right">{row.price !== undefined ? formatPrice(row.price) : "—"}</span>
                  <span className="text-right">
                    <Change value={row.change24h} />
                  </span>
                  <span className="hidden text-right text-app-muted md:block">{formatUsdCompact(row.volume24h)}</span>
                  {isSpot && <span className="hidden text-right text-app-muted md:block">{formatUsdCompact(row.liquidity)}</span>}
                  <span className="hidden truncate text-right text-[11px] text-app-muted md:block">{row.venues.join(" · ") || "—"}</span>
                </div>
              );
            })
          )}
        </div>

        <div className="hidden shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-app-hairline px-4 py-2 text-[11px] text-app-faint sm:flex">
          {[
            ["Ctrl K", "Open / close"],
            ["↑ ↓", "Move"],
            ["Enter", "Select"],
            ["Ctrl S", "Favorite"],
            ["Esc", "Close"],
          ].map(([key, label]) => (
            <span key={key} className="flex items-center gap-1.5">
              <kbd className="rounded border border-app-hairline-strong bg-app-chip px-1.5 font-sans font-semibold text-app-muted">{key}</kbd>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The market picker for the terminal (/perp, /swap): perp markets of the enabled perp venues, or every spot pair the
 * spot venues' pools offer (plus a live Jupiter search), with categories, favorites and keyboard control. Ctrl/⌘+K
 * opens it from anywhere in the terminal; the chart header's symbol button too.
 */
export function AssetSearchProvider({ children }: { children: React.ReactNode }) {
  const kind = terminalKindOf(usePathname()) ?? "perp";
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo(() => ({ open }), [open]);
  return (
    <AssetSearchContext.Provider value={value}>
      {children}
      {isOpen && <AssetSearchDialog kind={kind} onClose={close} />}
    </AssetSearchContext.Provider>
  );
}
