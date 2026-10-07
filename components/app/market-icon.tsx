"use client";

import { useState, useSyncExternalStore } from "react";
import { TickerAvatar } from "@/components/news/ticker-avatar";
import { assets } from "@/lib/data";
import { ICON_MISSES_KEY, readIconMisses, serializeIconMisses } from "@/lib/icon-misses";

const HYPERLIQUID_ICONS = "https://app.hyperliquid.xyz/coins";
const BINANCE_ICONS = "https://bin.bnbstatic.com/static/assets/logos";
const STOCK_LOGOS = "https://financialmodelingprep.com/image-stock";
const PARQET_LOGOS = "https://assets.parqet.com/logos/symbol";
/** Lighter's own market icons (lowercase symbol): most of its 200+ perps, including ones no other source has. */
const LIGHTER_ICONS = "https://assets.lighter.xyz/fe/token";

interface MarketIconProps {
  symbol: string;
  kind?: "crypto" | "stock";
  size?: number;
}

/**
 * Sources tried in order until one loads: the ones for the market's kind, then Lighter's, then the other kind's
 * (venues mislabel some markets, e.g. Lighter lists stocks next to tokens), then the same for the base name of
 * multiplied or USD-quoted tickers (1000PEPE / kPEPE → PEPE, SAMSUNGUSD → SAMSUNG), then the letter avatar.
 */
function iconSources(symbol: string, kind: MarketIconProps["kind"]): string[] {
  const unscaled = symbol.replace(/^1000+/, "").replace(/^k(?=[A-Z0-9]{2})/, "");
  const base = unscaled.length > 6 && unscaled.endsWith("USD") ? unscaled.slice(0, -3) : unscaled;
  return base && base !== symbol ? [...symbolSources(symbol, kind), ...symbolSources(base, kind)] : symbolSources(symbol, kind);
}

function symbolSources(symbol: string, kind: MarketIconProps["kind"]) {
  const stock = [
    `${HYPERLIQUID_ICONS}/xyz:${symbol}.svg`,
    `${STOCK_LOGOS}/${symbol}.png`,
    `${PARQET_LOGOS}/${symbol}?format=png`,
  ];
  const crypto = [`${HYPERLIQUID_ICONS}/${symbol}.svg`, `${BINANCE_ICONS}/${symbol}.png`];
  const lighter = [`${LIGHTER_ICONS}/${symbol.toLowerCase()}.png`];
  return kind === "stock" ? [...stock, ...lighter, ...crypto] : [...crypto, ...lighter, ...stock];
}

/** URLs that failed this week (`lib/icon-misses.ts`): every later icon skips them instead of requesting them again. */
let failedSources: Map<string, number> | null = null;

function knownMisses() {
  if (!failedSources) {
    try {
      failedSources = readIconMisses(localStorage.getItem(ICON_MISSES_KEY), Date.now());
    } catch {
      failedSources = new Map();
    }
  }
  return failedSources;
}

function rememberMiss(source: string) {
  const misses = knownMisses();
  misses.set(source, Date.now());
  try {
    localStorage.setItem(ICON_MISSES_KEY, serializeIconMisses(misses));
  } catch {}
}

const noSubscribe = () => () => {};

export function MarketIcon({ symbol, kind, size = 24 }: MarketIconProps) {
  // The server can't know the stored misses: skip them only after hydration, so the first client render matches.
  const isClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  const all = iconSources(symbol, kind ?? assets[symbol]?.kind);
  const sources = isClient ? all.filter((source) => !knownMisses().has(source)) : all;
  const sourceKey = sources.join(" ");
  const [failure, setFailure] = useState({ sourceKey, index: 0 });
  const index = failure.sourceKey === sourceKey ? failure.index : 0;

  if (index >= sources.length) return <TickerAvatar symbol={symbol} size={size} />;

  return (
    <img
      key={sources[index]}
      src={sources[index]}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => {
        rememberMiss(sources[index]);
        setFailure({ sourceKey, index: index + 1 });
      }}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}
