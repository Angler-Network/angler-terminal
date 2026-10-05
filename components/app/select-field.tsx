"use client";

import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

const LIST_GAP = 6;
const LIST_MAX_HEIGHT = 280;
const VIEWPORT_MARGIN = 8;

interface SelectFieldProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
}

export function SelectField({ label, value, options, onChange, className = "w-[150px]" }: SelectFieldProps) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex];

  const position = useCallback(() => {
    const trigger = triggerRef.current;
    const list = listRef.current;
    if (!trigger || !list) return;

    const rect = trigger.getBoundingClientRect();
    const height = Math.min(list.scrollHeight, LIST_MAX_HEIGHT);
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
    const opensUp = spaceBelow < height + LIST_GAP && rect.top > spaceBelow;
    const width = Math.max(rect.width, list.scrollWidth);
    const left = Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN);

    list.style.minWidth = `${rect.width}px`;
    list.style.left = `${Math.max(VIEWPORT_MARGIN, left)}px`;
    list.style.top = opensUp ? `${Math.max(VIEWPORT_MARGIN, rect.top - LIST_GAP - height)}px` : `${rect.bottom + LIST_GAP}px`;
  }, []);

  const close = useCallback((restoreFocus: boolean) => {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (isOpen) {
      if (!list.matches(":popover-open")) list.showPopover();
      position();
      list.children[selectedIndex]?.scrollIntoView({ block: "nearest" });
    } else if (list.matches(":popover-open")) {
      list.hidePopover();
    }
  }, [isOpen, position, selectedIndex]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !listRef.current?.contains(target)) close(false);
    }
    function handleViewportChange(event: Event) {
      if (event.type === "scroll" && listRef.current?.contains(event.target as Node)) return;
      position();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isOpen, close, position]);

  function open() {
    setActiveIndex(selectedIndex);
    setIsOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    close(true);
  }

  function moveActive(next: number) {
    const index = Math.min(options.length - 1, Math.max(0, next));
    setActiveIndex(index);
    listRef.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!isOpen) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        open();
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveActive(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key.length === 1) {
      const query = event.key.toLowerCase();
      const start = activeIndex + 1;
      const match = [...options.slice(start), ...options.slice(0, start)].findIndex((option) =>
        option.label.toLowerCase().startsWith(query),
      );
      if (match !== -1) moveActive((start + match) % options.length);
    }
  }

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-activedescendant={isOpen ? `${listId}-${activeIndex}` : undefined}
        onClick={() => (isOpen ? close(false) : open())}
        onKeyDown={handleKeyDown}
        className={`flex h-10 ${className} items-center gap-2 rounded-xl border pl-4 pr-3 text-left text-[14px] text-app-ink outline-none transition-colors focus-visible:ring-4 focus-visible:ring-app-ring/60 ${
          isOpen ? "border-app-focus bg-app-field-hover" : "border-app-field-border bg-app-field hover:bg-app-field-hover"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
        <ChevronDown
          className={`size-4 shrink-0 text-app-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        popover="manual"
        className="scrollbar-list surface-menu fixed inset-auto m-0 max-h-[280px] overflow-y-auto overscroll-contain rounded-xl border border-app-hairline-strong bg-app-card p-1 text-app-ink shadow-[0_16px_40px_-12px_rgba(3,12,21,0.4)]"
      >
        {options.map((option, index) => {
          const isSelected = option.value === value;
          return (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={isSelected}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(index)}
              className={`flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg py-2 pl-3 pr-2.5 text-[14px] ${
                index === activeIndex ? "bg-app-chip" : ""
              } ${isSelected ? "font-semibold" : ""}`}
            >
              <span className="flex-1">{option.label}</span>
              <Check className={`size-4 shrink-0 text-app-accent ${isSelected ? "" : "invisible"}`} aria-hidden />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
