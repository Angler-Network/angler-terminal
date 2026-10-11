"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopover } from "@/components/terminal/anchored-popover";
import { VenueLogo } from "@/components/terminal/venue-logo";
import { DEFAULT_FUNDING_COMPARE } from "@/lib/preferences";
import { FUNDING_VENUES, TRADABLE_FUNDING_VENUES, type FundingVenue } from "@/lib/trading/funding";

/** Venue names in the picker and the column headers. */
export const FUNDING_VENUE_LABELS: Record<FundingVenue, string> = {
  hyperliquid: "Hyperliquid",
  lighter: "Lighter",
  lighterRh: "Lighter RH",
  aster: "Aster",
  orderly: "Orderly",
  extended: "Extended",
  binance: "Binance",
  bybit: "Bybit",
};

const GROUPS: Array<{ label: string; venues: FundingVenue[] }> = [
  { label: "Perp DEX", venues: FUNDING_VENUES.filter((venue) => TRADABLE_FUNDING_VENUES.includes(venue)) },
  { label: "CEX · Reference", venues: FUNDING_VENUES.filter((venue) => !TRADABLE_FUNDING_VENUES.includes(venue)) },
];

/**
 * "Compare venues · N selected": which funding columns the Markets table shows. Grouped Perp DEX / CEX here only (the
 * table mixes them), with a search for when the list grows; at least one venue stays picked. The selection is kept in
 * the venue order, so columns never shuffle, and a venue added to the site later only appears in this list.
 */
export function FundingVenuePicker({ value, onChange }: { value: FundingVenue[]; onChange: (venues: FundingVenue[]) => void }) {
  const { triggerRef, panelRef, anchor, open, toggle } = useAnchoredPopover<HTMLButtonElement>({ height: 420 });
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const toggleVenue = (venue: FundingVenue) => {
    const next = value.includes(venue) ? value.filter((entry) => entry !== venue) : [...value, venue];
    if (next.length > 0) onChange(FUNDING_VENUES.filter((entry) => next.includes(entry)));
  };
  const isDefault = value.length === DEFAULT_FUNDING_COMPARE.length && value.every((venue) => DEFAULT_FUNDING_COMPARE.includes(venue));
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-semibold transition-colors ${
          open ? "border-app-hairline-strong bg-app-chip text-app-ink" : "border-app-hairline bg-app-chip text-app-muted hover:text-app-ink"
        }`}
      >
        <span className="flex -space-x-1">
          {value.slice(0, 3).map((venue) => (
            <VenueLogo key={venue} name={FUNDING_VENUE_LABELS[venue]} size={14} />
          ))}
        </span>
        Compare venues
        <span className="tabular-nums opacity-60">· {value.length} selected</span>
        <ChevronDown className="size-3.5" aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef as React.RefObject<HTMLDivElement>}
            role="dialog"
            aria-label="Funding venues to compare"
            style={anchor ?? undefined}
            className="surface-menu fixed z-50 flex max-h-[min(460px,75vh)] w-64 flex-col rounded-xl border border-app-hairline-strong bg-app-dialog p-1 text-[12px] shadow-lg"
          >
            <label className="m-1 flex h-8 shrink-0 items-center gap-2 rounded-lg border border-app-field-border bg-app-field px-2">
              <Search className="size-3.5 text-app-faint" aria-hidden />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search venues"
                aria-label="Search venues"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-app-ink outline-hidden placeholder:text-app-faint"
              />
            </label>
            <p className="mx-2 mb-1 text-[11px] leading-snug text-app-muted">Selection also limits spread and arbitrage calculations.</p>
            <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {GROUPS.map((group) => {
                const venues = group.venues.filter((venue) => !needle || FUNDING_VENUE_LABELS[venue].toLowerCase().includes(needle));
                if (venues.length === 0) return null;
                return (
                  <div key={group.label} role="group" aria-label={group.label}>
                    <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-app-faint">{group.label}</p>
                    {venues.map((venue) => {
                      const on = value.includes(venue);
                      const last = on && value.length === 1;
                      return (
                        <button
                          key={venue}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          disabled={last}
                          title={last ? "At least one venue stays in the table" : undefined}
                          onClick={() => toggleVenue(venue)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-app-ink hover:bg-app-chip disabled:cursor-default"
                        >
                          <span
                            aria-hidden
                            className={`flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border ${on ? "border-app-accent bg-app-accent text-app-on-accent" : "border-app-field-border"}`}
                          >
                            {on && <Check className="size-2.5" strokeWidth={3} />}
                          </span>
                          <VenueLogo name={FUNDING_VENUE_LABELS[venue]} size={16} />
                          <span className="truncate">{FUNDING_VENUE_LABELS[venue]}</span>
                          {!TRADABLE_FUNDING_VENUES.includes(venue) && (
                            <span
                              title="Funding shown for comparison only: not tradable here, so never part of the spread or an arb"
                              className="ml-auto rounded bg-app-chip px-1.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-app-faint"
                            >
                              Reference
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex shrink-0 items-center justify-between border-t border-app-hairline px-2 pb-1 pt-2 text-[11px]">
              <button type="button" onClick={() => onChange([...FUNDING_VENUES])} className="font-semibold text-app-muted hover:text-app-ink">
                Select all
              </button>
              <button type="button" disabled={isDefault} onClick={() => onChange(DEFAULT_FUNDING_COMPARE)} className="font-semibold text-app-muted hover:text-app-ink disabled:opacity-40">
                Reset to default
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
