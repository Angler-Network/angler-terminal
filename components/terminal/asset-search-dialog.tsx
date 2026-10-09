"use client";

import { Search, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useModalEnter } from "@/components/app/use-motion";
import { formatPrice } from "@/lib/format";
import { MARKET_CATEGORIES, type MarketCategory } from "@/lib/markets/category";
import type { TerminalKind } from "@/lib/terminal-kind";
import { formatUsdCompact } from "@/lib/trading/market-stats";
import { isWatched, toggleWatch } from "@/lib/watchlist";
import { onSpotView } from "@/lib/spot/book-spot";
import { evmSwapChain } from "@/lib/venues/uniswap/chains";
import { Change, TokenIcon, VenueMarks, networkOptions, perpVenueOptions, rowChain, rowHasAddress, rowOnNetwork, usePerpRows, useSpotRows, type MarketRow, type NetworkKey } from "./market-rows";
import { NetworkFilter, type NetworkFilterLabels } from "./network-filter";
import { useSelectedAsset } from "./selected-asset";
import type { TokenChoice, TokenPickRequest } from "./asset-search";

/** Rows drawn at first and per scroll: the swap list has 1,600+ tokens, and drawing them all made opening the window stutter. */
const PERP_VENUE_LABELS: NetworkFilterLabels = { all: "All venues", search: "Search venues", unit: ["market", "markets"], venueGroup: "Perp venues" };
const PAGE_ROWS = 50;

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function pinnedRow(token: TokenChoice, venue: string): MarketRow {
  const id = `pick:${token.mint}`;
  return {
    id,
    symbol: token.symbol,
    name: token.name ?? token.symbol,
    asset: token.symbol,
    mint: token.mint,
    icon: token.icon,
    kind: "crypto",
    category: "crypto",
    price: token.price,
    venues: [venue],
    verified: token.verified ?? true,
    chain: token.chainId ? evmSwapChain(token.chainId)?.key : undefined,
    watch: { id, kind: "spot", symbol: token.symbol, asset: token.symbol, mint: token.mint },
  };
}

type Tab = "favorites" | "all" | "launchpads" | MarketCategory;

type SortKey = "name" | "price" | "change1h" | "change6h" | "change" | "volume" | "liquidity";
type SortState = { key: SortKey; dir: "desc" | "asc" } | null;

const sortValue: Record<Exclude<SortKey, "name">, (row: MarketRow) => number | undefined> = {
  price: (row) => row.price,
  change1h: (row) => row.change1h,
  change6h: (row) => row.change6h,
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

export function AssetSearchDialog({ kind, pick, onClose }: { kind: TerminalKind; pick?: TokenPickRequest | null; onClose: () => void }) {
  const { preferences, updatePreference } = usePreferences();
  const { selectAsset } = useSelectedAsset();
  const backdropRef = useModalEnter(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  // Launchpad views: every token there is unverified, so they filter by bonding-curve stage instead.
  const [stage, setStage] = useState<"curve" | "graduated" | null>(null);
  const [sort, setSort] = useState<SortState>(null);
  // The one chain, launchpad or venue to show; null = every network.
  const [network, setNetwork] = useState<NetworkKey | null>(null);
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(PAGE_ROWS);
  const moreRef = useRef<HTMLButtonElement>(null);
  // /spot lists order-book markets (Hyperliquid, Lighter) and Arcus stock tokens; /swap the pools and aggregators.
  const isBook = kind === "book" && !pick;
  const isSpot = kind === "spot" || kind === "book" || Boolean(pick);
  const launchpadView = isSpot && (tab === "launchpads" || Boolean(network?.startsWith("lp:")));

  const perpRows = usePerpRows(!isSpot);
  const { rows: spotRows, searching } = useSpotRows(isSpot, query, pick ? (pick.scope === "evm" ? ["uniswap", "jupiter"] : ["jupiter"]) : isBook ? ["hyperliquid", "lighter", "arcus"] : ["jupiter", "uniswap"]);

  const watchlist = preferences.watchlist;
  const rows = useMemo(() => {
    const source = (isSpot ? spotRows : perpRows) ?? [];
    const wanted = query.trim().toUpperCase();
    const watched = new Set(watchlist.map((entry) => entry.id));
    // Favorites the current list doesn't carry (found by a search once) still show, without live numbers.
    const extra: MarketRow[] =
      tab === "favorites"
        ? watchlist
            .filter((entry) => entry.kind === (kind === "book" ? "spot" : kind) && (entry.kind !== "spot" || onSpotView(entry) === isBook) && !source.some((row) => row.id === entry.id))
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
    const matches = (row: MarketRow) =>
      rowOnNetwork(row, network) && (!wanted || row.symbol.toUpperCase().includes(wanted) || row.name.toUpperCase().includes(wanted) || rowHasAddress(row, query));
    const filtered = [...source, ...extra].filter(
      (row) =>
        (tab === "all" || (tab === "favorites" ? watched.has(row.id) : tab === "launchpads" ? Boolean(row.launchpad) : row.category === tab)) &&
        // Launchpad tokens are new, nearly all unverified: the Launchpads tab and a launchpad filter show them anyway
        // (buying one asks for a tick).
        (launchpadView ? !stage || row.launchStage === stage : !isSpot || !verifiedOnly || row.verified) &&
        matches(row) &&
        (!pick || row.mint !== pick.exclude),
    );
    const sorted = sortRows(filtered, sort);
    if (!pick || tab !== "all") return sorted;
    // Picking a token: the wallet's and the common ones first (verified or not, the user holds them), then the rest;
    // a pasted mint nobody lists yet can still be used.
    const pinned = pick.pinned
      .filter((token) => token.mint !== pick.exclude)
      .map((token) => pinnedRow(token, token.source ?? "Wallet"))
      .filter(matches);
    const pinnedMints = new Set(pinned.map((row) => row.mint));
    const rest = sorted.filter((row) => !pinnedMints.has(row.mint));
    const address = query.trim();
    const pasted =
      SOLANA_ADDRESS.test(address) && address !== pick.exclude && !pinnedMints.has(address) && !rest.some((row) => row.mint === address)
        ? [pinnedRow({ mint: address, symbol: `${address.slice(0, 4)}…${address.slice(-4)}`, name: "Use this address", verified: false }, "Address")]
        : [];
    return [...pasted, ...pinned, ...rest];
  }, [isSpot, isBook, spotRows, perpRows, query, tab, verifiedOnly, watchlist, kind, sort, pick, network, launchpadView, stage]);

  // Counts follow "Verified only" (the search box narrows the list, not the tabs).
  const counts = useMemo(() => {
    const byCategory: Partial<Record<MarketCategory | "launchpads", number>> = {};
    for (const row of (isSpot ? spotRows : perpRows) ?? []) {
      if (!rowOnNetwork(row, network)) continue;
      // Launchpad tokens count whatever "Verified only" says, like the tab shows them.
      if (isSpot && row.launchpad) byCategory.launchpads = (byCategory.launchpads ?? 0) + 1;
      if (isSpot && verifiedOnly && !row.verified && !network?.startsWith("lp:")) continue;
      if (network?.startsWith("lp:") && stage && row.launchStage !== stage) continue;
      byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
    }
    return byCategory;
  }, [isSpot, spotRows, perpRows, verifiedOnly, network, stage]);

  // The network filter lists only the chains, launchpads and venues the spot rows actually have (a Solana token picker
  // shows none).
  const chainOptions = useMemo(() => {
    // Perps filter by venue (Hyperliquid, Lighter…) the same way.
    if (!isSpot) {
      const venues = perpVenueOptions(perpRows ?? []);
      return venues.length > 1 ? venues : [];
    }
    // Pinned tokens (USDC on each chain…) count too: a chain only they reach used to read "0 tokens".
    const options = networkOptions([...(spotRows ?? []), ...(pick?.pinned ?? []).map((token) => pinnedRow(token, ""))]);
    return options.length > 1 ? options : [];
  }, [isSpot, spotRows, perpRows, pick]);

  useEffect(() => {
    setActive(0);
    setLimit(PAGE_ROWS);
  }, [query, tab, verifiedOnly, sort, network, stage]);
  const visible = useMemo(() => rows.slice(0, limit), [rows, limit]);
  // The next 50 load as the list scrolls near its end.
  useEffect(() => {
    const node = moreRef.current;
    if (!node || limit >= rows.length) return;
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && setLimit((current) => current + PAGE_ROWS), { root: listRef.current, rootMargin: "300px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [limit, rows.length]);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (row: MarketRow | undefined) => {
    if (!row) return;
    if (pick) {
      if (!row.mint) return;
      const pinned = pick.pinned.find((token) => token.mint === row.mint);
      pick.onPick(pinned ?? { mint: row.mint, symbol: row.symbol, icon: row.icon, name: row.name, verified: row.verified, price: row.price });
    } else {
      selectAsset(row.asset, row.mint, rowChain(row) === "arcus" ? "arcus" : undefined);
    }
    onClose();
  };
  const toggleFavorite = (row: MarketRow | undefined) => row && updatePreference("watchlist", toggleWatch(watchlist, row.watch));

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => {
        const next = Math.min(rows.length - 1, index + 1);
        if (next >= limit) setLimit((current) => current + PAGE_ROWS);
        return next;
      });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(rows[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (!pick && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      toggleFavorite(rows[active]);
    }
  };

  const loading = (isSpot ? spotRows : perpRows) === null;
  const tabs: Array<{ value: Tab; label: string; count?: number }> = [
    { value: "all", label: "All" },
    ...MARKET_CATEGORIES.filter((category) => counts[category.value]).map((category) => ({ value: category.value as Tab, label: category.label, count: counts[category.value] })),
    // Pump.fun, Pons and the other launchpads' tokens (the network picker narrows to one launchpad).
    ...(counts.launchpads ? [{ value: "launchpads" as Tab, label: "Launchpads", count: counts.launchpads }] : []),
  ];
  // Spot: 1h and 6h change next to 24h from md up; the venue column is logos only (names on hover).
  const columns = isSpot ? "grid-cols-[minmax(0,1fr)_96px_80px] md:grid-cols-[minmax(0,1fr)_104px_72px_72px_80px_84px_84px_56px]" : "grid-cols-[minmax(0,1fr)_96px_80px] md:grid-cols-[minmax(0,1fr)_110px_86px_100px_130px]";

  return (
    <div ref={backdropRef} className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 p-3 pt-[8vh] sm:p-6 sm:pt-[10vh]" role="presentation" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={pick ? pick.title : isBook ? "Search spot markets" : isSpot ? "Search swap tokens" : "Search perp markets"}
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
            placeholder={
              pick
                ? pick.scope === "evm"
                  ? "Search any token on Base, Arbitrum, Ethereum or Solana by name, ticker or address"
                  : "Search any Solana token by name, ticker or paste an address"
                : isBook ? "Search Hyperliquid, Lighter and Arcus spot markets" : isSpot ? "Search any token by name, ticker or address" : "Search perp markets by ticker"
            }
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="asset-search-list"
            aria-activedescendant={rows[active] ? `asset-search-${active}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-hidden placeholder:text-app-faint"
          />
          {launchpadView ? (
            <div role="group" aria-label="Bonding curve" className="flex shrink-0 items-center rounded-lg bg-app-chip/50 p-0.5 text-[12px] font-semibold">
              {(
                [
                  [null, "All"],
                  ["curve", "On curve"],
                  ["graduated", "Graduated"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={stage === value}
                  onClick={() => setStage(value)}
                  className={`rounded-md px-2.5 py-1 transition-colors ${stage === value ? "bg-app-chip text-app-ink" : "text-app-muted hover:text-app-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : isSpot && !isBook && (
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
          {!pick && (
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
          )}
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
          {pick && <span className={`shrink-0 pl-3 text-[12px] font-semibold text-app-muted ${chainOptions.length ? "" : "ml-auto"}`}>{pick.title}</span>}
          {chainOptions.length > 0 && (
            <div className="sticky right-0 ml-auto shrink-0 bg-app-dialog pl-3">
              <NetworkFilter options={chainOptions} value={network} onChange={setNetwork} labels={isSpot ? undefined : PERP_VENUE_LABELS} />
            </div>
          )}
        </div>

        <div className={`grid shrink-0 ${columns} gap-3 border-b border-app-hairline px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-faint`}>
          <SortHeader label="Name" column="name" sort={sort} onSort={setSort} />
          <SortHeader label="Price" column="price" sort={sort} onSort={setSort} className="text-right" />
          {isSpot && <SortHeader label="1h" column="change1h" sort={sort} onSort={setSort} className="hidden text-right md:block" />}
          {isSpot && <SortHeader label="6h" column="change6h" sort={sort} onSort={setSort} className="hidden text-right md:block" />}
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
            visible.map((row, index) => {
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
                    {!pick && (
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
                    )}
                    <TokenIcon row={row} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-semibold">{row.symbol}</span>
                        {launchpadView && row.launchStage ? (
                          <span
                            className={`rounded px-1 text-[9px] font-semibold uppercase ${row.launchStage === "graduated" ? "bg-app-up/15 text-app-up" : "bg-[#9db4ff]/15 text-[#9db4ff]"}`}
                          >
                            {row.launchStage === "graduated" ? "Graduated" : "On curve"}
                          </span>
                        ) : (
                          isSpot && !row.verified && <span className="rounded bg-[#f5c97b]/15 px-1 text-[9px] font-semibold uppercase text-[#f5c97b]">Unverified</span>
                        )}
                      </span>
                      <span className="block truncate text-[11px] text-app-muted">{row.name}</span>
                    </span>
                  </span>
                  <span className="truncate text-right">{row.price !== undefined ? formatPrice(row.price) : "—"}</span>
                  {isSpot && (
                    <span className="hidden text-right md:block">
                      <Change value={row.change1h} />
                    </span>
                  )}
                  {isSpot && (
                    <span className="hidden text-right md:block">
                      <Change value={row.change6h} />
                    </span>
                  )}
                  <span className="text-right">
                    <Change value={row.change24h} />
                  </span>
                  <span className="hidden text-right text-app-muted md:block">{formatUsdCompact(row.volume24h)}</span>
                  {isSpot && <span className="hidden text-right text-app-muted md:block">{formatUsdCompact(row.liquidity)}</span>}
                  <span className="hidden min-w-0 text-right text-[11px] text-app-muted md:block">
                    <VenueMarks venues={row.venues} iconsOnly={isSpot} />
                  </span>
                </div>
              );
            })
          )}
          {!loading && limit < rows.length && (
            <button
              ref={moreRef}
              type="button"
              onClick={() => setLimit((current) => current + PAGE_ROWS)}
              className="block w-full py-2.5 text-center text-[12px] font-semibold text-app-muted hover:text-app-ink"
            >
              Show {Math.min(PAGE_ROWS, rows.length - limit)} more ({rows.length - limit} left)
            </button>
          )}
        </div>

        <div className="hidden shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-app-hairline px-4 py-2 text-[11px] text-app-faint sm:flex">
          {[
            ["Ctrl K", "Open / close"],
            ["↑ ↓", "Move"],
            ["Enter", "Select"],
            ["Ctrl S", "Favorite"],
            ["Esc", "Close"],
          ]
            .filter(([key]) => !pick || key !== "Ctrl S")
            .map(([key, label]) => (
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

