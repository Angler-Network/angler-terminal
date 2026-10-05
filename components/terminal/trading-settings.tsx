"use client";

import { Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { sizePresets } from "@/lib/trading/presets";

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-app-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-app-muted">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 accent-[rgb(var(--app-accent))]" />
    </label>
  );
}

function SizeSelect({ label, presets, value, onChange }: { label: string; presets: number[]; value: number | null; onChange: (value: number | null) => void }) {
  return (
    <label className="flex items-center gap-3 text-[13px]">
      <span className="flex-1 font-medium text-app-ink">{label}</span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
        className="h-8 rounded-lg border border-app-hairline-strong bg-app-chip px-2 text-[12px] text-app-ink"
      >
        <option value="">${presets[0]} (first preset)</option>
        {presets.slice(1).map((preset) => (
          <option key={preset} value={preset}>
            ${preset}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Trading-from-news settings. One-click trading and the impact sound are off by default. */
export function TradingSettings() {
  const { preferences, updatePreference } = usePreferences();
  const [isOpen, setIsOpen] = useState(false);
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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-label="Trading settings"
        title="Trading settings"
        className="inline-flex size-9 items-center justify-center rounded-xl border border-app-hairline-strong bg-app-card/60 text-app-muted hover:text-app-ink"
      >
        <Settings className="size-4" />
      </button>
      {isOpen && (
        <div
          role="dialog"
          aria-label="Trading settings"
          className="surface-menu absolute right-0 top-11 z-40 flex w-80 flex-col gap-3 rounded-xl border border-app-hairline-strong bg-app-card p-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)]"
        >
          <h2 className="text-[13px] font-semibold text-app-ink">Trading from news</h2>
          <Toggle
            label="One-click trading"
            hint="A single click on a size button places the order right away, without the confirm click."
            checked={preferences.oneClickTrading}
            onChange={(value) => updatePreference("oneClickTrading", value)}
          />
          <label className="flex items-center gap-3 text-[13px]">
            <span className="flex-1">
              <span className="block font-medium text-app-ink">Trade buttons from impact</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-app-muted">News below this score shows no size buttons.</span>
            </span>
            <input
              type="number"
              min={0}
              max={100}
              value={preferences.tradeMinImpact}
              onChange={(event) => updatePreference("tradeMinImpact", Math.min(100, Math.max(0, Math.round(Number(event.target.value) || 0))))}
              className="h-8 w-16 rounded-lg border border-app-hairline-strong bg-app-chip px-2 text-right text-[12px] tabular-nums text-app-ink"
            />
          </label>
          <SizeSelect label="Default perp size (keyboard)" presets={sizePresets.perp} value={preferences.defaultPerpUsd} onChange={(value) => updatePreference("defaultPerpUsd", value)} />
          <SizeSelect label="Default spot size (keyboard)" presets={sizePresets.spot} value={preferences.defaultSpotUsd} onChange={(value) => updatePreference("defaultSpotUsd", value)} />
          <label className="flex items-center gap-3 text-[13px]">
            <span className="flex-1 font-medium text-app-ink">Leverage for perp trades</span>
            <select
              value={preferences.newsLeverage}
              onChange={(event) => updatePreference("newsLeverage", Number(event.target.value))}
              className="h-8 rounded-lg border border-app-hairline-strong bg-app-chip px-2 text-[12px] tabular-nums text-app-ink"
            >
              {[...new Set([1, 2, 3, 5, 10, 20, preferences.newsLeverage])].sort((a, b) => a - b).map((value) => (
                <option key={value} value={value}>
                  {value}x
                </option>
              ))}
            </select>
          </label>
          <div className="h-px bg-app-hairline" />
          <label className="flex items-center gap-3 text-[13px]">
            <span className="flex-1 font-medium text-app-ink">High-impact threshold</span>
            <input
              type="number"
              min={0}
              max={100}
              value={preferences.highImpactThreshold}
              onChange={(event) => updatePreference("highImpactThreshold", Math.min(100, Math.max(0, Math.round(Number(event.target.value) || 0))))}
              className="h-8 w-16 rounded-lg border border-app-hairline-strong bg-app-chip px-2 text-right text-[12px] tabular-nums text-app-ink"
            />
          </label>
          <Toggle
            label="Sound on high-impact news"
            checked={preferences.highImpactSound}
            onChange={(value) => updatePreference("highImpactSound", value)}
          />
          <p className="text-[10px] text-app-faint">Not financial advice. Scores are model outputs.</p>
        </div>
      )}
    </div>
  );
}
