"use client";

import { Check, LayoutGrid } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { layoutPresets, navModeChange, panelNames, type NavMode, type TapePosition, type TerminalPanels } from "@/lib/preferences";
import { usePreferences } from "./preferences-provider";

function samePanels(a: TerminalPanels, b: TerminalPanels) {
  return (Object.keys(a) as Array<keyof TerminalPanels>).every((key) => a[key] === b[key]);
}

function CheckRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-app-ink hover:bg-app-chip"
    >
      <span className={`grid size-4 shrink-0 place-items-center rounded border ${checked ? "border-app-accent bg-app-accent text-app-on-accent" : "border-app-hairline-strong"}`}>
        {checked && <Check className="size-3" />}
      </span>
      {label}
    </button>
  );
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" className="mx-2.5 flex gap-0.5 rounded-lg bg-app-chip p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-7 flex-1 rounded-md text-[12px] font-semibold ${value === option.value ? "bg-app-card text-app-ink shadow-sm" : "text-app-muted hover:text-app-ink"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Sidebar entry that edits the terminal layout: one-tap presets, then each panel on or off, plus the sidebar and
 * top bar. Opens beside the rail (fixed, since the rail clips overflow).
 */
export function LayoutMenu({
  className,
  labelNode,
  placement = "right",
  iconClassName = "size-5",
}: {
  className: string;
  labelNode: React.ReactNode;
  /** Beside the rail, or under a top-bar button. */
  placement?: "right" | "below";
  iconClassName?: string;
}) {
  const { preferences, updatePreference } = usePreferences();
  const pathname = usePathname();
  const router = useRouter();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOpen = anchor !== null;

  useEffect(() => {
    if (!isOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setAnchor(null);
        return;
      }
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setAnchor(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [isOpen]);

  const setPanels = (panels: TerminalPanels) => {
    updatePreference("panels", panels);
    // Layout changes only show on the terminal page.
    if (pathname !== "/") router.push("/");
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        title="Layout"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setAnchor(isOpen ? null : (buttonRef.current?.getBoundingClientRect() ?? null))}
        className={className}
      >
        <LayoutGrid className={iconClassName} strokeWidth={1.75} aria-hidden />
        {labelNode}
      </button>
      {anchor && (
        <div
          ref={menuRef}
          role="menu"
          style={
            placement === "below"
              ? { left: Math.max(8, Math.min(anchor.left, window.innerWidth - 300)), top: anchor.bottom + 8 }
              : { left: anchor.right + 10, top: Math.max(8, Math.min(anchor.top - 8, window.innerHeight - 560)) }
          }
          className="surface-menu fixed z-50 w-72 rounded-2xl border border-app-hairline-strong bg-app-dialog p-2 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)]"
        >
          <p className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-faint">Layout</p>
          <div className="flex flex-col gap-1">
            {layoutPresets.map((preset) => {
              const active = samePanels(preset.panels, preferences.panels);
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => setPanels(preset.panels)}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                    active ? "border-app-accent bg-app-accent/10" : "border-app-hairline hover:bg-app-chip"
                  }`}
                >
                  <span className="block text-[13px] font-semibold text-app-ink">{preset.name}</span>
                  <span className="block text-[11px] leading-snug text-app-muted">{preset.description}</span>
                </button>
              );
            })}
          </div>
          <p className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-faint">Panels</p>
          {(Object.keys(panelNames) as Array<keyof TerminalPanels>).map((key) => (
            <CheckRow
              key={key}
              label={panelNames[key]}
              checked={preferences.panels[key]}
              onToggle={() => setPanels({ ...preferences.panels, [key]: !preferences.panels[key] })}
            />
          ))}
          <p className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-faint">Navigation</p>
          <Choice
            value={preferences.navMode}
            options={[
              { value: "sidebar", label: "Sidebar" },
              { value: "top", label: "Top bar" },
            ]}
            onChange={(value: NavMode) => {
              const next = navModeChange(value, preferences.tapePosition);
              updatePreference("navMode", next.navMode);
              updatePreference("tapePosition", next.tapePosition);
            }}
          />
          <p className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-faint">Price tape</p>
          <Choice
            value={preferences.tapePosition}
            options={[
              { value: "top", label: "Top" },
              { value: "bottom", label: "Bottom" },
              { value: "off", label: "Off" },
            ]}
            onChange={(value: TapePosition) => updatePreference("tapePosition", value)}
          />
          <div className="my-1.5 border-t border-app-hairline" />
          {preferences.navMode === "sidebar" && (
            <CheckRow label="Show sidebar" checked={preferences.showSidebar} onToggle={() => updatePreference("showSidebar", !preferences.showSidebar)} />
          )}
          <CheckRow label="Show top bar" checked={preferences.showTopBar} onToggle={() => updatePreference("showTopBar", !preferences.showTopBar)} />
        </div>
      )}
    </>
  );
}
