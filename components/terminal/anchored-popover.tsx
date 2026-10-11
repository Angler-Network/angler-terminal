"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

export interface PopoverAnchor {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/**
 * A small panel opened from a trigger and portaled to the body, fixed to the viewport (a dialog's blur or a panel's
 * overflow would clip it otherwise). It opens below the trigger, or above when there's more room there, aligned to the
 * trigger's left or right edge, and closes on a press outside, Escape (which goes no further: the window behind stays
 * open), a scroll that moves the trigger, or resize. `height` is the panel's expected height, to choose the side.
 */
export function useAnchoredPopover<T extends HTMLElement = HTMLElement>({ align = "right", height = 200 }: { align?: "left" | "right"; height?: number } = {}) {
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const triggerRef = useRef<T>(null);
  const panelRef = useRef<HTMLElement>(null);
  const open = anchor !== null;
  const close = useCallback(() => setAnchor(null), []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => !triggerRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node) && setAnchor(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setAnchor(null);
    };
    // Only a scroll that moves the trigger (its panel or the page under it) closes it: the terminal's own panels (order
    // book, ticker tape) scroll by themselves all the time.
    const scroll = (event: Event) => {
      const target = event.target;
      if (target === document || (target instanceof Node && triggerRef.current && target.contains(triggerRef.current))) setAnchor(null);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);
  const toggle = useCallback(
    (event?: MouseEvent) => {
      event?.stopPropagation();
      const rect = triggerRef.current?.getBoundingClientRect();
      if (anchor || !rect) return setAnchor(null);
      const side = align === "right" ? { right: Math.max(8, window.innerWidth - rect.right) } : { left: Math.max(8, rect.left) };
      const up = window.innerHeight - rect.bottom < height + 12 && rect.top > window.innerHeight - rect.bottom;
      setAnchor(up ? { bottom: window.innerHeight - rect.top + 4, ...side } : { top: rect.bottom + 4, ...side });
    },
    [anchor, align, height],
  );
  return { triggerRef, panelRef, anchor, open, toggle, close };
}
