"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { ROW_CHAINS, TokenIcon, rowChain, useSpotRows, type MarketRow, type RowChain } from "@/components/terminal/market-rows";
import { useSelectedAsset } from "@/components/terminal/selected-asset";
import { CoinIcon } from "@/components/terminal/token-icon";
import { useSpotListings } from "@/components/terminal/use-spot-listings";
import { formatPrice } from "@/lib/format";
import { assetNames, matchesQuery, sortAssetRows, type AssetRow } from "@/lib/markets/rows";
import type { SpotListing } from "@/lib/spot/listings";
import { TERMINAL_PATHS } from "@/lib/terminal-kind";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId } from "@/lib/venues/types";

const RESULTS = 12;

/** The empty field's hint per market type: a prompt, then example assets with their icons. */
const HINTS: Record<Scope, { prompt: string; examples: Array<{ symbol: string; label: string; kind?: "crypto" | "stock" }> }> = {
  perp: { prompt: "Find a perp:", examples: [{ symbol: "BTC", label: "BTC" }, { symbol: "TSLA", label: "Tesla", kind: "stock" }, { symbol: "GOLD", label: "GOLD", kind: "stock" }] },
  book: { prompt: "Find a spot market:", examples: [{ symbol: "HYPE", label: "HYPE" }, { symbol: "NVDA", label: "NVDA", kind: "stock" }] },
  spot: { prompt: "Find a token:", examples: [{ symbol: "SOL", label: "SOL" }, { symbol: "ETH", label: "ETH" }, { symbol: "JUP", label: "JUP" }] },
};

type Scope = "perp" | "book" | "spot";

const SCOPES: Array<{ value: Scope; label: string }> = [
  { value: "perp", label: "Perp Dex" },
  { value: "book", label: "Spot Dex" },
  { value: "spot", label: "Swap" },
];

/** The spot venues each spot view searches (same as the terminal's own search). */
const SPOT_VENUES: Record<Exclude<Scope, "perp">, SpotListing["venue"][]> = { book: ["hyperliquid", "lighter", "arcus"], spot: ["jupiter", "uniswap"] };

/** Perp venue logos: the venue's site icon, Robinhood Chain's badge on Lighter RH. */
const PERP_MARKS: Record<PerpVenueId, { domain: string; chain?: number }> = {
  hyperliquid: { domain: "hyperliquid.xyz" },
  lighter: { domain: "lighter.xyz" },
  lighterRh: { domain: "lighter.xyz", chain: 4663 },
  aster: { domain: "asterdex.com" },
};

interface Filter {
  id: string;
  label: string;
  icon: React.ReactNode;
}

function chainIcon(key: RowChain) {
  const logo = ROW_CHAINS.find((chain) => chain.key === key)?.logo ?? `/chains/${key}.svg`;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={logo} alt="" width={16} height={16} className="size-4 rounded-full" />;
}

function Change({ value }: { value: number | undefined }) {
  if (value === undefined) return <span className="text-app-faint">—</span>;
  return (
    <span className={value >= 0 ? "text-app-up" : "text-app-down"}>
      {value >= 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

function ResultLine({ icon, symbol, name, price, change, onOpen }: { icon: React.ReactNode; symbol: string; name?: string; price?: number; change?: number; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] tabular-nums hover:bg-app-chip/40">
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-app-ink">{symbol}</span>
          {name && <span className="block truncate text-[11px] text-app-faint">{name}</span>}
        </span>
        <span className="text-app-muted">{price ? formatPrice(price) : "—"}</span>
        <span className="w-[68px] text-right">
          <Change value={change} />
        </span>
      </button>
    </li>
  );
}

/**
 * The home page's market search: perps (optionally on one venue), order-book spot or swaps, opening the pick in the
 * matching terminal view. A perp venue picked here becomes the order panel's venue.
 */
export function HomeSearch({ rows, venueIds }: { rows: AssetRow[]; venueIds: PerpVenueId[] }) {
  const router = useRouter();
  const { selectAsset, requestPerpVenue } = useSelectedAsset();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("perp");
  const [filter, setFilter] = useState<string | null>(null);
  const typed = query.trim().length > 0;
  // The results close on a click outside the search and reopen when the field is used again.
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  // Perps: names come from the spot listings (perp venues send tickers only), loaded once someone types.
  const listings = useSpotListings(typed && scope === "perp");
  const names = useMemo(() => assetNames(listings), [listings]);
  const { rows: spotRows } = useSpotRows(scope !== "perp", query, scope === "perp" ? undefined : SPOT_VENUES[scope]);

  const filters = useMemo<Filter[]>(() => {
    if (scope === "perp") {
      return venueIds.map((id) => ({
        id,
        label: PERP_VENUE_NAMES[id],
        icon: <CoinIcon src={`/api/favicon?domain=${PERP_MARKS[id].domain}`} symbol={PERP_VENUE_NAMES[id]} chain={PERP_MARKS[id].chain} size={16} />,
      }));
    }
    const present = new Set((spotRows ?? []).map(rowChain));
    return ROW_CHAINS.filter((chain) => present.has(chain.key)).map((chain) => ({ id: chain.key, label: chain.name.replace(/ \(.*\)$/, ""), icon: chainIcon(chain.key) }));
  }, [scope, venueIds, spotRows]);

  const perpResults = useMemo(() => {
    if (scope !== "perp" || !typed) return [];
    const matched = rows.filter((row) => matchesQuery(row, query, names) && (!filter || row.venues[filter as PerpVenueId]));
    return sortAssetRows(matched, "volume").slice(0, RESULTS);
  }, [scope, typed, rows, query, names, filter]);

  const spotResults = useMemo(() => {
    if (scope === "perp" || !typed || !spotRows) return [];
    const wanted = query.trim().toUpperCase();
    const matched = spotRows.filter(
      (row) =>
        (!filter || rowChain(row) === filter) &&
        (row.symbol.toUpperCase().includes(wanted) || row.name.toUpperCase().includes(wanted) || row.asset.includes(wanted) || row.mint === query.trim()),
    );
    // Verified tokens first, then the busiest.
    return matched.sort((a, b) => Number(b.verified) - Number(a.verified) || (b.volume24h ?? 0) - (a.volume24h ?? 0)).slice(0, RESULTS);
  }, [scope, typed, spotRows, query, filter]);

  const openPerp = (symbol: string) => {
    selectAsset(symbol);
    requestPerpVenue((filter as PerpVenueId | null) ?? null);
    router.push(TERMINAL_PATHS.perp);
  };
  const openSpot = (row: MarketRow) => {
    selectAsset(row.asset, row.mint, rowChain(row) === "arcus" ? "arcus" : undefined);
    router.push(scope === "book" ? TERMINAL_PATHS.book : TERMINAL_PATHS.spot);
  };
  const openFirst = () => {
    if (scope === "perp" && perpResults[0]) openPerp(perpResults[0].symbol);
    else if (scope !== "perp" && spotResults[0]) openSpot(spotResults[0]);
  };

  const pickScope = (next: Scope) => {
    setScope(next);
    setFilter(null);
  };

  const count = scope === "perp" ? perpResults.length : spotResults.length;
  const loading = scope === "perp" ? rows.length === 0 : spotRows === null;

  return (
    <div className="flex max-w-[640px] flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Market type" className="flex shrink-0 gap-0.5 rounded-lg bg-app-chip p-0.5">
          {SCOPES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={scope === option.value}
              onClick={() => pickScope(option.value)}
              className={`h-7 shrink-0 rounded-md px-3 text-[12px] font-semibold transition-colors ${
                scope === option.value ? "bg-app-card text-app-ink shadow-xs" : "text-app-muted hover:text-app-ink"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {filters.length > 1 && (
          <div key={scope} role="group" aria-label="Venue" className="home-slide flex flex-wrap gap-1.5">
            {filters.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                aria-label={option.label}
                title={option.label}
                onClick={() => setFilter((current) => (current === option.id ? null : option.id))}
                className={`inline-flex size-7 shrink-0 items-center justify-center rounded-lg border transition-[border-color,background-color,opacity] ${
                  filter === option.id ? "border-app-ink/60 bg-app-card" : filter ? "border-app-hairline opacity-50 hover:opacity-100" : "border-app-hairline hover:border-app-hairline-strong"
                }`}
              >
                {option.icon}
              </button>
            ))}
          </div>
        )}
      </div>
      <div ref={boxRef} className="relative">
        <label className="relative flex h-11 items-center gap-2.5 rounded-xl border border-app-field-border bg-app-field px-3.5">
          <Search className="size-[18px] text-app-faint" aria-hidden />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") openFirst();
              if (event.key === "Escape") setOpen(false);
            }}
            aria-label="Find a market"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-app-ink outline-hidden placeholder:text-app-faint"
          />
          {!query && (
            // A placeholder can't hold icons, so the hint sits over the empty field (clicks pass through to it).
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-[42px] right-3.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[14px] text-app-faint">
              {HINTS[scope].prompt}
              {HINTS[scope].examples.map((example, index) => (
                // Phones show the first example only; the rest would run past the field.
                <span key={example.symbol} className={`items-center gap-1 ${index === 0 ? "inline-flex" : "hidden sm:inline-flex"}`}>
                  <MarketIcon symbol={example.symbol} kind={example.kind} size={16} />
                  {example.label}
                  <span className={index === 0 ? "sm:hidden" : "hidden"}>…</span>
                  <span className={index === 0 ? "hidden sm:inline" : "hidden sm:inline"}>{index < HINTS[scope].examples.length - 1 ? "," : "…"}</span>
                </span>
              ))}
            </span>
          )}
        </label>
        {typed && open && (
          <ul className="scrollbar-subtle absolute inset-x-0 top-full z-20 mt-1.5 max-h-[380px] overflow-y-auto rounded-xl border border-app-hairline-strong bg-app-card py-1 shadow-[0_16px_40px_rgba(0,0,0,0.4)]">
            {scope === "perp"
              ? perpResults.map((row) => (
                  <ResultLine
                    key={row.symbol}
                    icon={<MarketIcon symbol={row.symbol} kind={row.kind} size={24} />}
                    symbol={row.symbol}
                    name={names.get(row.symbol)}
                    price={row.price}
                    change={row.change24hPct}
                    onOpen={() => openPerp(row.symbol)}
                  />
                ))
              : spotResults.map((row) => (
                  <ResultLine
                    key={row.id}
                    icon={<TokenIcon row={row} />}
                    symbol={row.symbol}
                    name={`${row.name} · ${row.venues.join(", ")}`}
                    price={row.price}
                    change={row.change24h}
                    onOpen={() => openSpot(row)}
                  />
                ))}
            {count === 0 && <li className="px-4 py-3 text-[12px] text-app-muted">{loading ? "Loading markets…" : "No market matches."}</li>}
          </ul>
        )}
      </div>

    </div>
  );
}
