"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { terminalKindOf } from "@/lib/terminal-kind";

// The window itself (rows, filters, live search) loads the first time it opens, not with the terminal.
const AssetSearchDialog = dynamic(() => import("./asset-search-dialog").then((module) => module.AssetSearchDialog), { ssr: false });

/** A token picked to pay with (or receive) in a swap card: a Solana mint, or an EVM ref ("evm:<chain>:<address>"). */
export interface TokenChoice {
  mint: string;
  symbol: string;
  icon?: string;
  name?: string;
  verified?: boolean;
  price?: number;
  /** Shown in the venue column of a pinned row ("Wallet", "Popular", "Uniswap · Base"). */
  source?: string;
  /** EVM pinned rows: the chain and decimals (search rows carry the chain in `mint`). */
  chainId?: number;
  decimals?: number;
}

/**
 * The search opened as a token picker, `pinned` ones first: Solana tokens (the Solana card), or EVM tokens on every
 * Uniswap chain plus Solana tokens (the EVM card, `scope: "evm"`: cross-chain through Relay or LI.FI).
 */
export interface TokenPickRequest {
  title: string;
  scope?: "solana" | "evm";
  pinned: TokenChoice[];
  /** The token on the other side of the swap. */
  exclude?: string;
  onPick: (token: TokenChoice) => void;
}

interface AssetSearchValue {
  open: () => void;
  pickToken: (request: TokenPickRequest) => void;
}

const AssetSearchContext = createContext<AssetSearchValue | null>(null);

export function useAssetSearch() {
  const context = useContext(AssetSearchContext);
  if (!context) throw new Error("useAssetSearch must be used within AssetSearchProvider");
  return context;
}

/**
 * The market picker for the terminal (/perp, /swap): perp markets of the enabled perp venues, or every spot pair the
 * spot venues' pools offer (plus a live Jupiter search), with categories, favorites and keyboard control. Ctrl/⌘+K
 * opens it from anywhere in the terminal; the chart header's symbol button too.
 */
export function AssetSearchProvider({ children }: { children: React.ReactNode }) {
  const kind = terminalKindOf(usePathname()) ?? "perp";
  const [isOpen, setIsOpen] = useState(false);
  const [pick, setPick] = useState<TokenPickRequest | null>(null);
  const open = useCallback(() => (setPick(null), setIsOpen(true)), []);
  const pickToken = useCallback((request: TokenPickRequest) => (setPick(request), setIsOpen(true)), []);
  const close = useCallback(() => (setIsOpen(false), setPick(null)), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPick(null);
        setIsOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo(() => ({ open, pickToken }), [open, pickToken]);
  return (
    <AssetSearchContext.Provider value={value}>
      {children}
      {isOpen && <AssetSearchDialog kind={kind} pick={pick} onClose={close} />}
    </AssetSearchContext.Provider>
  );
}
