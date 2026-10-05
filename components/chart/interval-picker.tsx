"use client";

import { ChevronDown, ChevronUp, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { chartIntervals, intervalGroups, intervalLabel, intervalShortLabel, type ChartInterval } from "@/lib/chart/candles";

const byOrder = (a: ChartInterval, b: ChartInterval) => chartIntervals.indexOf(a) - chartIntervals.indexOf(b);

/** TradingView-style interval picker: starred intervals as quick buttons, the full list in a dropdown. */
export function IntervalPicker() {
  const { preferences, updatePreference } = usePreferences();
  const interval = preferences.chartInterval;
  const favorites = preferences.chartFavoriteIntervals;
  const [isOpen, setIsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setIsOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  const select = (value: ChartInterval) => {
    updatePreference("chartInterval", value);
    setIsOpen(false);
  };

  const toggleFavorite = (value: ChartInterval) =>
    updatePreference(
      "chartFavoriteIntervals",
      favorites.includes(value) ? favorites.filter((entry) => entry !== value) : [...favorites, value].sort(byOrder),
    );

  // Keep the active interval visible as a quick button even when it isn't starred.
  const quick = [...new Set([...favorites, interval])].sort(byOrder);

  return (
    <div ref={rootRef} className="relative ml-auto flex items-center gap-0.5 rounded-lg bg-app-chip p-0.5">
      <div role="group" aria-label="Chart interval" className="flex gap-0.5">
        {quick.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={interval === value}
            title={intervalLabel(value)}
            onClick={() => select(value)}
            className={`h-7 rounded-md px-2 text-[12px] font-semibold transition-colors ${
              interval === value ? "bg-app-card text-app-ink shadow-sm" : "text-app-muted hover:text-app-ink"
            }`}
          >
            {intervalShortLabel(value)}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="All intervals"
        onClick={() => setIsOpen((open) => !open)}
        className="inline-flex h-7 w-6 items-center justify-center rounded-md text-app-muted hover:text-app-ink"
      >
        <ChevronDown className={`size-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Intervals"
          className="surface-menu scrollbar-subtle absolute right-0 top-9 z-30 max-h-[360px] w-52 overflow-y-auto rounded-xl border border-app-hairline-strong bg-app-card py-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)]"
        >
          {intervalGroups.map((group, index) => (
            <div key={group.label} className={index > 0 ? "mt-1 border-t border-app-hairline pt-1" : undefined}>
              <button
                type="button"
                onClick={() => setCollapsed((current) => ({ ...current, [group.label]: !current[group.label] }))}
                className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-app-faint hover:text-app-muted"
              >
                {group.label}
                {collapsed[group.label] ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronUp className="size-3.5" aria-hidden />}
              </button>
              {!collapsed[group.label] &&
                group.intervals.map((value) => {
                  const isFavorite = favorites.includes(value);
                  return (
                    <div
                      key={value}
                      role="option"
                      aria-selected={interval === value}
                      className={`group flex items-center ${interval === value ? "bg-app-chip" : "hover:bg-app-chip/60"}`}
                    >
                      <button
                        type="button"
                        onClick={() => select(value)}
                        className={`flex-1 px-3 py-1.5 text-left text-[13px] ${interval === value ? "font-semibold text-app-ink" : "text-app-ink/85"}`}
                      >
                        {intervalLabel(value)}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleFavorite(value)}
                        aria-pressed={isFavorite}
                        aria-label={`${isFavorite ? "Remove" : "Add"} ${intervalLabel(value)} ${isFavorite ? "from" : "to"} favorites`}
                        className={`px-3 py-1.5 transition-opacity ${isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
                      >
                        <Star className={`size-3.5 ${isFavorite ? "fill-[#f5a524] text-[#f5a524]" : "text-app-faint"}`} aria-hidden />
                      </button>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
