"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface PickerOption<T> {
  value: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  note?: string;
}

/**
 * An inline dropdown that reads as a word in a sentence (the funds window) or a token button (the swap card). The list
 * is portaled to the body and fixed to the viewport: inside a dialog or a scrolling panel, a blur or overflow would make
 * it the containing block and clip it.
 */
export function Picker<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  buttonClassName = "inline-flex items-center gap-1.5 rounded-lg bg-app-chip py-0.5 pl-1.5 pr-2 font-semibold text-app-ink hover:bg-app-selected disabled:opacity-60 disabled:hover:bg-app-chip",
  children,
}: {
  value: T;
  options: Array<PickerOption<T>>;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  buttonClassName?: string;
  /** Replaces the button's icon and label (the swap card shows the token's symbol and chain). */
  children?: ReactNode;
}) {
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLSpanElement>(null);
  const current = options.find((option) => option.value === value);
  const open = anchor !== null;
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => !ref.current?.contains(event.target as Node) && !listRef.current?.contains(event.target as Node) && setAnchor(null);
    // Only a scroll that moves the picker (the dialog, or the page under it) closes the list.
    const follow = (event: Event) => event.target instanceof Node && ref.current && event.target.contains(ref.current) && setAnchor(null);
    const dismiss = () => setAnchor(null);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);
  const toggle = () => {
    const rect = ref.current?.getBoundingClientRect();
    setAnchor(open || !rect ? null : { top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 248) });
  };
  return (
    <span ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
        className={buttonClassName}
      >
        {children ?? (
          <>
            {current?.icon}
            {current?.label ?? value}
          </>
        )}
        <ChevronDown className="size-4 text-app-muted" aria-hidden />
      </button>
      {open &&
        createPortal(
          <span ref={listRef} role="listbox" style={anchor ?? undefined} className="surface-menu fixed z-50 flex w-60 flex-col rounded-xl border border-app-hairline-strong bg-app-dialog p-1 shadow-lg">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value);
                  setAnchor(null);
                }}
                className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] ${
                  option.value === value ? "bg-app-chip text-app-ink" : "text-app-ink hover:bg-app-chip"
                } disabled:cursor-default disabled:text-app-faint disabled:hover:bg-transparent`}
              >
                <span className="flex items-center gap-2">
                  {option.icon}
                  {option.label}
                </span>
                {option.note && <span className="text-[10px] font-semibold uppercase tracking-[0.06em]">{option.note}</span>}
              </button>
            ))}
          </span>,
          document.body,
        )}
    </span>
  );
}

