"use client";

import { ChevronDown, Search } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatPrice } from "@/lib/format";
import type { SpotListing } from "@/lib/spot/listings";
import { CoinIcon } from "./token-icon";
import { useSpotListings, useSpotSearch } from "./use-spot-listings";

export interface TokenChoice {
  mint: string;
  symbol: string;
  icon?: string;
  name?: string;
  verified?: boolean;
  price?: number;
}

const WIDTH = 300;
const TOP_LIMIT = 60;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const fromListing = (listing: SpotListing): TokenChoice => ({
  mint: listing.address,
  symbol: listing.symbol,
  icon: listing.icon,
  name: listing.name,
  verified: listing.verified,
  price: listing.price,
});

/**
 * Any Solana token for the swap card's "Pay with" / "Receive" side: the common ones and the wallet's tokens first, then
 * the most traded pairs, and a live Jupiter search by ticker, name or pasted mint (unverified tokens included and
 * marked). The list is portaled to the body like `Picker`.
 */
export function TokenPicker({
  value,
  pinned,
  exclude,
  onChange,
  label,
  buttonClassName,
  children,
}: {
  value: string;
  /** Shown first (USDC, SOL, USDT, then held tokens). */
  pinned: TokenChoice[];
  /** The token on the other side of the swap. */
  exclude?: string;
  onChange: (token: TokenChoice) => void;
  label: string;
  buttonClassName?: string;
  children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const open = anchor !== null;
  const listings = useSpotListings(open);
  const results = useSpotSearch(open ? query : "");

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => !ref.current?.contains(event.target as Node) && !listRef.current?.contains(event.target as Node) && setAnchor(null);
    const follow = (event: Event) => event.target instanceof Node && ref.current && event.target.contains(ref.current) && setAnchor(null);
    const dismiss = () => setAnchor(null);
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setAnchor(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  const toggle = () => {
    const rect = ref.current?.getBoundingClientRect();
    setQuery("");
    setAnchor(open || !rect ? null : { top: rect.bottom + 4, left: Math.max(8, Math.min(rect.right - WIDTH, window.innerWidth - WIDTH - 8)) });
  };

  const searching = query.trim().length >= 2;
  const wanted = query.trim().toUpperCase();
  const solana = (list: SpotListing[] | null | undefined) => (list ?? []).filter((listing) => listing.venue === "jupiter").map(fromListing);
  const rows: TokenChoice[] = searching
    ? [
        ...pinned.filter((token) => token.symbol.toUpperCase().includes(wanted) || token.mint === query.trim()),
        ...solana(results),
      ]
    : [...pinned, ...solana(listings).slice(0, TOP_LIMIT)];
  const seen = new Set<string>();
  const unique = rows.filter((token) => token.mint !== exclude && !seen.has(token.mint) && seen.add(token.mint));
  // A pasted mint the search hasn't found yet can still be picked.
  const pasted = searching && SOLANA_ADDRESS.test(query.trim()) && !seen.has(query.trim()) ? query.trim() : null;

  const pick = (token: TokenChoice) => {
    onChange(token);
    setAnchor(null);
  };

  return (
    <span ref={ref} className="relative inline-block">
      <button type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={toggle} className={buttonClassName}>
        {children}
        <ChevronDown className="size-4 text-app-muted" aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            style={{ ...anchor, width: WIDTH }}
            className="surface-menu fixed z-50 flex max-h-[min(420px,70vh)] flex-col rounded-xl border border-app-hairline-strong bg-app-dialog shadow-lg"
          >
            <label className="m-1.5 flex h-9 shrink-0 items-center gap-2 rounded-lg border border-app-hairline-strong px-2.5 focus-within:border-app-accent">
              <Search className="size-4 text-app-muted" aria-hidden />
              <input
                autoFocus
                aria-label="Search tokens"
                placeholder="Search name, ticker or paste address"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-app-ink outline-hidden placeholder:text-app-faint"
              />
            </label>
            <div role="listbox" aria-label={label} className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
              {pasted && (
                <button
                  type="button"
                  onClick={() => pick({ mint: pasted, symbol: `${pasted.slice(0, 4)}…`, verified: false })}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-app-ink hover:bg-app-chip"
                >
                  Use address <span className="font-mono text-[11px] text-app-muted">{pasted.slice(0, 6)}…{pasted.slice(-4)}</span>
                </button>
              )}
              {unique.map((token) => (
                <button
                  key={token.mint}
                  type="button"
                  role="option"
                  aria-selected={token.mint === value}
                  onClick={() => pick(token)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${token.mint === value ? "bg-app-chip" : "hover:bg-app-chip"}`}
                >
                  <CoinIcon src={token.icon} symbol={token.symbol} chain="solana" size={22} />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-app-ink">
                      {token.symbol}
                      {token.verified === false && (
                        <span className="rounded bg-app-down/15 px-1 text-[9px] font-bold uppercase tracking-[0.06em] text-app-down">Unverified</span>
                      )}
                    </span>
                    {token.name && <span className="truncate text-[11px] text-app-faint">{token.name}</span>}
                  </span>
                  {token.price !== undefined && <span className="shrink-0 text-[11px] tabular-nums text-app-muted">{formatPrice(token.price)}</span>}
                </button>
              ))}
              {searching && results === undefined && <p className="px-2.5 py-2 text-[12px] text-app-faint">Searching…</p>}
              {searching && results !== undefined && unique.length === 0 && !pasted && <p className="px-2.5 py-2 text-[12px] text-app-faint">No token found.</p>}
              {!searching && listings === null && <p className="px-2.5 py-2 text-[12px] text-app-faint">Loading tokens…</p>}
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
