"use client";

import { History } from "lucide-react";
import { useEffect, useState } from "react";
import { horizonLabel, reactionBucket, type NewsReaction as Reaction } from "@/lib/news/reaction";

const TTL_MS = 15 * 60_000;
const MIN_EVENTS = 5;
const UP_HORIZON_MIN = 240;

const cache = new Map<string, { at: number; promise: Promise<Reaction | null> }>();

function loadReaction(symbol: string, minImpact: number) {
  const key = `${symbol}:${minImpact}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.promise;
  const promise = fetch(`/api/news/reaction?coin=${encodeURIComponent(symbol)}&min=${minImpact}`)
    .then((response) => (response.ok ? (response.json() as Promise<Reaction>) : null))
    .catch(() => null);
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

function useNewsReaction(symbol: string, minImpact: number) {
  const [reaction, setReaction] = useState<Reaction | null>(null);
  useEffect(() => {
    let isActive = true;
    setReaction(null);
    void loadReaction(symbol, minImpact).then((next) => isActive && setReaction(next));
    return () => {
      isActive = false;
    };
  }, [symbol, minImpact]);
  return reaction;
}

/**
 * How the asset moved after its past news of the same impact (last ~50 days, Hyperliquid mainnet prices): typical
 * size of the move per horizon and how often it went up. History, not a forecast.
 */
export function NewsReaction({ symbol, score }: { symbol: string; score: number }) {
  const minImpact = reactionBucket(score);
  const reaction = useNewsReaction(symbol, minImpact);
  const horizons = reaction?.horizons.filter((horizon) => horizon.count >= MIN_EVENTS) ?? [];
  if (!reaction || reaction.events < MIN_EVENTS || horizons.length === 0) return null;
  const up = reaction.horizons.find((horizon) => horizon.horizonMin === UP_HORIZON_MIN && horizon.count >= MIN_EVENTS);
  return (
    <div
      onClick={(event) => event.stopPropagation()}
      title={`How ${symbol} moved after its ${reaction.events} news items scored ${minImpact}+ in the last 50 days (Hyperliquid mainnet prices): the typical size of the move, and how often it was up after ${horizonLabel(UP_HORIZON_MIN)}. History, not a forecast.`}
      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-app-chip/50 px-2 py-1 text-[11px] tabular-nums text-app-muted"
    >
      <History className="size-3 shrink-0 text-app-faint" aria-hidden />
      <span>
        After {reaction.events} {symbol} news {minImpact}+:
      </span>
      {horizons.map((horizon) => (
        <span key={horizon.horizonMin} className="text-app-ink">
          <span className="text-app-faint">{horizonLabel(horizon.horizonMin)}</span> ±{horizon.avgAbsPct.toFixed(horizon.avgAbsPct < 1 ? 2 : 1)}%
        </span>
      ))}
      {up && (
        <span className={up.upShare >= 0.55 ? "text-app-up" : up.upShare <= 0.45 ? "text-app-down" : "text-app-ink"}>
          up {Math.round(up.upShare * 100)}%
        </span>
      )}
    </div>
  );
}
