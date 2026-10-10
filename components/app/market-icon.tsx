"use client";

import { useState, useSyncExternalStore } from "react";
import { TickerAvatar } from "@/components/news/ticker-avatar";
import { assets } from "@/lib/data";
import { ICON_MISSES_KEY, readIconMisses, serializeIconMisses } from "@/lib/icon-misses";
import { iconSources } from "@/lib/market-icons";

interface MarketIconProps {
  symbol: string;
  kind?: "crypto" | "stock";
  size?: number;
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
      // Binance's logo CDN answers 403 to requests that name another site as the referrer.
      referrerPolicy="no-referrer"
      onError={() => {
        rememberMiss(sources[index]);
        setFailure({ sourceKey, index: index + 1 });
      }}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}
