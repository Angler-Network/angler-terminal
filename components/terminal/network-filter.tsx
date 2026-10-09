"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { chainLogo, type NetworkKey, type NetworkOption } from "./market-rows";

const GROUPS: Array<{ id: NetworkOption["group"]; label: string }> = [
  { id: "chain", label: "Chains" },
  { id: "launchpad", label: "Launchpads" },
  { id: "venue", label: "Order books & stock tokens" },
];
const PANEL_WIDTH = 400;

function NetworkLogo({ option, size }: { option: NetworkOption; size: number }) {
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <img src={option.logo} alt="" width={size} height={size} className="size-full rounded-full object-cover" />
      {option.chain && (
        <img
          src={chainLogo(option.chain)}
          alt=""
          width={10}
          height={10}
          className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-app-dialog"
        />
      )}
    </span>
  );
}

/**
 * The market search's network filter: one button (the chosen chain or launchpad, else "All networks") that opens a
 * panel of chains, launchpads (Pump.fun, Pons…) and order-book venues, grouped, searchable and counted. Replaces a row
 * of logos that ran out of room once the chain list grew. The panel is portaled (the tab row scrolls sideways).
 */
export function NetworkFilter({ options, value, onChange }: { options: NetworkOption[]; value: NetworkKey | null; onChange: (key: NetworkKey | null) => void }) {
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const [query, setQuery] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const open = anchor !== null;
  const current = options.find((option) => option.key === value);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const close = (event: Event) => !buttonRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node) && setAnchor(null);
    const dismiss = () => setAnchor(null);
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (open || !rect) return setAnchor(null);
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
    setQuery("");
    setAnchor({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), width });
  };
  const choose = (key: NetworkKey | null) => {
    onChange(key);
    setAnchor(null);
    buttonRef.current?.focus();
  };

  const groups = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const shown = wanted ? options.filter((option) => option.name.toLowerCase().includes(wanted) || option.key.toLowerCase().includes(wanted)) : options;
    return GROUPS.map((group) => ({ ...group, options: shown.filter((option) => option.group === group.id) })).filter((group) => group.options.length > 0);
  }, [options, query]);
  const first = groups[0]?.options[0];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className={`flex h-8 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-[12px] font-semibold transition-colors ${
          current ? "border-app-hairline-strong bg-app-chip text-app-ink" : "border-app-hairline text-app-muted hover:border-app-hairline-strong hover:text-app-ink"
        }`}
      >
        {current ? (
          <NetworkLogo option={current} size={16} />
        ) : (
          <span className="flex shrink-0" aria-hidden>
            {options.slice(0, 3).map((option, index) => (
              <img
                key={option.key}
                src={option.logo}
                alt=""
                width={16}
                height={16}
                className={`size-4 rounded-full ring-2 ring-app-dialog ${index ? "-ml-1.5" : ""}`}
              />
            ))}
          </span>
        )}
        <span className="max-w-[120px] truncate">{current ? current.name : "All networks"}</span>
        {current ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Show every network"
            onClick={(event) => {
              event.stopPropagation();
              choose(null);
            }}
            className="-mr-1 grid size-4 place-items-center rounded text-app-muted hover:text-app-ink"
          >
            <X className="size-3.5" />
          </span>
        ) : (
          <ChevronDown className="size-3.5" aria-hidden />
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Networks"
            style={{ top: anchor.top, left: anchor.left, width: anchor.width }}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              // Keys stay here: the search window's own Escape, arrows and Enter mustn't act on its list.
              event.stopPropagation();
              if (event.key === "Escape") {
                setAnchor(null);
                buttonRef.current?.focus();
              } else if (event.key === "Enter" && event.target === inputRef.current && first) {
                choose(first.key);
              }
            }}
            className="surface-menu fixed z-[60] flex max-h-[min(520px,70vh)] flex-col overflow-hidden rounded-xl border border-app-hairline-strong bg-app-dialog text-app-ink shadow-[0_24px_60px_-20px_rgba(3,12,21,0.75)]"
          >
            <div className="flex items-center gap-2 border-b border-app-hairline px-3 py-2.5">
              <Search className="size-4 shrink-0 text-app-muted" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search chains and launchpads"
                aria-label="Search chains and launchpads"
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-app-faint"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {!query.trim() && (
                <button
                  type="button"
                  onClick={() => choose(null)}
                  className={`mb-1 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold ${value ? "hover:bg-app-chip/60" : "bg-app-chip"}`}
                >
                  All networks
                  {!value && <Check className="size-4 text-app-muted" aria-hidden />}
                </button>
              )}
              {groups.map((group) => (
                <section key={group.id} className="pt-1.5">
                  <h3 className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-app-faint">{group.label}</h3>
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {group.options.map((option) => {
                      const on = option.key === value;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          aria-pressed={on}
                          onClick={() => choose(on ? null : option.key)}
                          className={`flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                            on ? "border-app-hairline-strong bg-app-chip" : "border-transparent hover:bg-app-chip/60"
                          }`}
                        >
                          <NetworkLogo option={option} size={20} />
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-semibold">{option.name}</span>
                            <span className="block text-[10px] text-app-faint">{option.count.toLocaleString("en-US")} {option.count === 1 ? "token" : "tokens"}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {groups.length === 0 && <p className="px-2.5 py-6 text-center text-[12px] text-app-muted">No chain or launchpad matches “{query.trim()}”.</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
