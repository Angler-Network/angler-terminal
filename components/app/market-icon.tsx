"use client";

import { useState } from "react";
import { TickerAvatar } from "@/components/news/ticker-avatar";
import { assets } from "@/lib/data";

const HYPERLIQUID_ICONS = "https://app.hyperliquid.xyz/coins";
const BINANCE_ICONS = "https://bin.bnbstatic.com/static/assets/logos";
const STOCK_LOGOS = "https://financialmodelingprep.com/image-stock";
const PARQET_LOGOS = "https://assets.parqet.com/logos/symbol";

interface MarketIconProps {
  symbol: string;
  kind?: "crypto" | "stock";
  size?: number;
}

function iconSources(symbol: string, kind: MarketIconProps["kind"]) {
  const stock = [
    `${HYPERLIQUID_ICONS}/xyz:${symbol}.svg`,
    `${STOCK_LOGOS}/${symbol}.png`,
    `${PARQET_LOGOS}/${symbol}?format=png`,
  ];
  const crypto = [`${HYPERLIQUID_ICONS}/${symbol}.svg`, `${BINANCE_ICONS}/${symbol}.png`];
  if (kind === "stock") return stock;
  return kind === "crypto" ? crypto : [...crypto, ...stock];
}

export function MarketIcon({ symbol, kind, size = 24 }: MarketIconProps) {
  const sources = iconSources(symbol, kind ?? assets[symbol]?.kind);
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
      onError={() => setFailure({ sourceKey, index: index + 1 })}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}
