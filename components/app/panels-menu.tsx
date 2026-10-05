"use client";

import { Check, LayoutGrid } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { panelNames, type TerminalPanels } from "@/lib/preferences";
import { usePreferences } from "./preferences-provider";

/** Top-bar menu to show or hide terminal panels (same setting as Settings → Layout). */
export function PanelsMenu() {
  const { preferences, updatePreference } = usePreferences();
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [isOpen]);

  return (
    <div ref={ref} className="relative hidden lg:block">
      <button
        type="button"
        aria-label="Panels"
        aria-expanded={isOpen}
        title="Show or hide panels"
        onClick={() => setIsOpen((open) => !open)}
        className="grid size-9 place-items-center rounded-xl text-app-muted transition-colors hover:bg-app-chip hover:text-app-ink"
      >
        <LayoutGrid className="size-4" />
      </button>
      {isOpen && (
        <div role="menu" className="surface-menu absolute right-0 top-11 z-50 w-56 rounded-xl border border-app-hairline-strong bg-app-dialog p-1 shadow-lg">
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-faint">Panels</p>
          {(Object.keys(panelNames) as Array<keyof TerminalPanels>).map((key) => {
            const checked = preferences.panels[key];
            return (
              <button
                key={key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                onClick={() => updatePreference("panels", { ...preferences.panels, [key]: !checked })}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-app-ink hover:bg-app-chip"
              >
                <span className={`grid size-4 place-items-center rounded border ${checked ? "border-app-accent bg-app-accent text-app-on-accent" : "border-app-hairline-strong"}`}>
                  {checked && <Check className="size-3" />}
                </span>
                {panelNames[key]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
