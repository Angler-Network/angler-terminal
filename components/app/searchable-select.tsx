"use client";

import { ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

function matches(haystack: string, query: string) {
  const text = haystack.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => text.includes(term));
}

interface SearchableSelectProps<T> {
  items: T[];
  value: string;
  onChange: (key: string) => void;
  getKey: (item: T) => string;
  getSearchText: (item: T) => string;
  getDisplayValue: (item: T) => string;
  renderOption: (item: T) => ReactNode;
  renderSelectedIcon?: (item: T) => ReactNode;
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  compact?: boolean;
  /** Compact menus open under the field's left edge; "right" keeps one near a container's right edge inside it. */
  menuAlign?: "left" | "right";
  className?: string;
}

export function SearchableSelect<T>({
  items,
  value,
  onChange,
  getKey,
  getSearchText,
  getDisplayValue,
  renderOption,
  renderSelectedIcon,
  label,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  compact = false,
  menuAlign = "left",
  className = "",
}: SearchableSelectProps<T>) {
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = items.find((item) => getKey(item) === value);
  const results = useMemo(
    () => (query ? items.filter((item) => matches(getSearchText(item), query)) : items),
    [items, query, getSearchText],
  );

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    listRef.current?.scrollIntoView({ block: "nearest" });
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  function open() {
    setIsOpen(true);
    setQuery("");
    setActiveIndex(Math.max(0, items.findIndex((item) => getKey(item) === value)));
  }

  function select(item: T) {
    onChange(getKey(item));
    setIsOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function moveActive(offset: number) {
    if (results.length === 0) return;
    const next = (activeIndex + offset + results.length) % results.length;
    setActiveIndex(next);
    listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen && (event.key === "ArrowDown" || event.key === "Enter")) {
      event.preventDefault();
      open();
      return;
    }
    if (!isOpen) return;

    if (event.key === "Tab") {
      setIsOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (results[activeIndex]) select(results[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    }
  }

  function handleFieldMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === inputRef.current) return;
    event.preventDefault();
    if (isOpen) {
      setIsOpen(false);
    } else {
      inputRef.current?.focus();
      open();
    }
  }

  const activeOptionId = isOpen && results[activeIndex] ? `${listId}-${activeIndex}` : undefined;

  return (
    <div ref={containerRef} className={`${compact ? "relative" : ""} ${className}`}>
      <div
        onMouseDown={handleFieldMouseDown}
        className={`flex ${compact ? "h-9 gap-2 px-2.5" : "h-12 gap-2.5 px-3"} cursor-pointer items-center rounded-xl border bg-app-card transition ${
          isOpen ? "border-app-focus ring-4 ring-app-ring/40" : "border-app-hairline-strong"
        }`}
      >
        {!isOpen && selected && renderSelectedIcon ? (
          renderSelectedIcon(selected)
        ) : (
          <Search className="size-[18px] shrink-0 text-app-muted" aria-hidden />
        )}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          aria-label={label}
          value={isOpen ? query : selected ? getDisplayValue(selected) : ""}
          placeholder={isOpen ? searchPlaceholder : placeholder}
          onFocus={() => {
            if (!isOpen) open();
          }}
          onMouseDown={() => {
            if (!isOpen) open();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] font-medium text-app-ink outline-hidden placeholder:font-normal placeholder:text-app-faint"
        />
        <ChevronDown
          className={`size-4 shrink-0 text-app-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden
        />
      </div>

      {isOpen && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className={`scrollbar-list max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-app-hairline-strong bg-app-card p-1 ${
            compact
              ? `surface-menu absolute ${menuAlign === "right" ? "right-0" : "left-0"} top-full z-30 mt-1.5 w-full min-w-48 sm:w-72 shadow-[0_16px_40px_-12px_rgba(19,35,58,0.35)]`
              : "mt-2"
          }`}
        >
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-[13px] text-app-muted">{emptyMessage}</li>
          )}
          {results.map((item, index) => (
            <li
              key={getKey(item)}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={getKey(item) === value}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => select(item)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 ${
                index === activeIndex ? "bg-app-chip" : ""
              }`}
            >
              {renderOption(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
