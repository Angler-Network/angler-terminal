"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import {
  DEFAULT_TAPE_SYMBOLS,
  pickMarkets,
  pickQuote,
  tapeSpeedPixelsPerSecond,
  type Market,
  type TapeSettings,
} from "@/lib/markets/model";
import { useSelectedAsset } from "@/components/terminal/selected-asset";
import { usePreferences } from "./preferences-provider";
import { TickerPill } from "./ticker-pill";

const REFRESH_MS = 20_000;
const MIN_COPIES = 2;

interface TickerTapeProps {
  initial: TapeSettings;
  initialMarkets: Market[];
}

export function TickerTape({ initial, initialMarkets }: TickerTapeProps) {
  const t = useT();
  const { preferences, isLoaded } = usePreferences();
  const { newsFocus, focusAsset } = useSelectedAsset();
  const settings = isLoaded
    ? { market: preferences.tapeMarket, source: preferences.tapeSource, symbols: preferences.tapeSymbols }
    : initial;
  const [loaded, setLoaded] = useState({ market: initial.market, markets: initialMarkets });
  const symbolKey = (settings.symbols ?? DEFAULT_TAPE_SYMBOLS).join(",");
  const marketType = settings.market;

  useEffect(() => {
    if (!symbolKey) return;
    let isActive = true;

    const load = async () => {
      try {
        const response = await fetch(`/api/markets?market=${marketType}&symbols=${encodeURIComponent(symbolKey)}`);
        if (!response.ok) return;
        const fresh = (await response.json()) as Market[];
        if (!isActive) return;
        setLoaded((current) => {
          const merged = new Map(current.market === marketType ? current.markets.map((market) => [market.symbol, market]) : []);
          for (const market of fresh) merged.set(market.symbol, market);
          return { market: marketType, markets: [...merged.values()] };
        });
      } catch {}
    };
    const refresh = () => {
      if (document.visibilityState !== "hidden") void load();
    };

    void load();
    const interval = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      isActive = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [symbolKey, marketType]);

  const visible = useMemo(() => {
    if (!symbolKey) return [];
    return pickMarkets(loaded.markets, symbolKey.split(",")).flatMap((market) => {
      const picked = pickQuote(market, settings.source);
      return picked ? [{ market, quote: picked.quote }] : [];
    });
  }, [loaded, marketType, symbolKey, settings.source]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLUListElement>(null);
  const [layout, setLayout] = useState({ copies: MIN_COPIES, groupWidth: 0 });
  const isMoving = preferences.tapeMotion !== "off";
  const duration = layout.groupWidth / tapeSpeedPixelsPerSecond[preferences.tapeSpeed];
  const copies = isMoving ? layout.copies : 1;

  useEffect(() => {
    const viewport = viewportRef.current;
    const group = groupRef.current;
    if (!viewport || !group) return;

    const measure = () => {
      const groupWidth = group.scrollWidth;
      if (!groupWidth) return;
      const copies = Math.max(MIN_COPIES, Math.ceil(viewport.clientWidth / groupWidth) + 1);
      setLayout((current) =>
        current.copies === copies && Math.abs(current.groupWidth - groupWidth) < 1 ? current : { copies, groupWidth },
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(group);
    return () => observer.disconnect();
  }, []);

  const renderPills = (focusable: boolean) =>
    visible.map(({ market, quote }) => (
      <TickerPill
        key={market.symbol}
        market={market}
        quote={quote}
        upLabel={t("market.up")}
        downLabel={t("market.down")}
        onSelect={focusAsset}
        isActive={newsFocus === market.symbol.toUpperCase()}
        focusable={focusable}
      />
    ));

  return (
    <div
      ref={viewportRef}
      className={`ticker-tape min-w-0 flex-1 mask-[linear-gradient(90deg,transparent,#000_24px,#000_calc(100%-24px),transparent)] ${
        isMoving ? "overflow-hidden" : "overflow-x-auto scrollbar-none [&::-webkit-scrollbar]:hidden"
      }`}
    >
      <div
        className={`flex w-max ${isMoving ? "ticker-tape-track" : ""}`}
        style={
          {
            "--tape-duration": `${duration}s`,
            "--tape-shift": `${-100 / copies}%`,
            animationDirection: preferences.tapeMotion === "right" ? "reverse" : "normal",
          } as React.CSSProperties
        }
      >
        <ul ref={groupRef} aria-label={t("top.tickers")} className="flex shrink-0 items-center">
          {renderPills(true)}
        </ul>
        {Array.from({ length: copies - 1 }, (_, index) => (
          <ul key={index} aria-hidden className="flex shrink-0 items-center">
            {renderPills(false)}
          </ul>
        ))}
      </div>
    </div>
  );
}
