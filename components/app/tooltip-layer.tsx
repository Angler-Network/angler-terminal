"use client";

import { useEffect, useRef, useState } from "react";

const SHOW_DELAY_MS = 350;
const GAP = 8;
const EDGE = 8;

interface Tip {
  text: string;
  x: number;
  y: number;
  below: boolean;
}

/**
 * Every `title` on the site shown as the app's own tooltip instead of the browser's: on hover the title moves to
 * `data-tip` (so the native one never shows) and comes back on leave. Mouse only; touch and keyboard keep the title
 * and aria labels as they are. One listener for the whole page, so no component has to opt in.
 * A component that re-renders under a still mouse can put the title back (React sets it again when the text changes,
 * or replaces the element, e.g. venue chips when quotes arrive), and the browser would show its own tooltip after all:
 * a MutationObserver watches `title` attributes and takes over whatever is under the pointer again.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let target: HTMLElement | null = null;
    let timer: number | undefined;

    const restore = () => {
      window.clearTimeout(timer);
      if (target?.dataset.tip !== undefined) {
        target.setAttribute("title", target.dataset.tip);
        delete target.dataset.tip;
      }
      target = null;
      setTip(null);
    };

    let pointer: { x: number; y: number } | null = null;
    // The element just clicked: its tooltip stays hidden until the mouse moves to something else.
    let quiet: HTMLElement | null = null;

    const hover = (next: HTMLElement | null) => {
      if (next === target || (next && next === quiet)) return;
      restore();
      const text = next?.getAttribute("title")?.trim();
      if (!next || !text) return;
      target = next;
      next.dataset.tip = next.getAttribute("title") ?? "";
      next.removeAttribute("title");
      timer = window.setTimeout(() => {
        if (target !== next || !next.isConnected) return;
        const rect = next.getBoundingClientRect();
        const below = rect.top < 48;
        setTip({ text, x: rect.left + rect.width / 2, y: below ? rect.bottom + GAP : rect.top - GAP, below });
      }, SHOW_DELAY_MS);
    };

    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      pointer = { x: event.clientX, y: event.clientY };
      const over = (event.target as Element | null)?.closest?.("[title], [data-tip]") as HTMLElement | null;
      if (over !== quiet) quiet = null;
      hover((event.target as Element | null)?.closest?.("[title]") as HTMLElement | null);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "mouse") pointer = { x: event.clientX, y: event.clientY };
    };

    // A title that comes back (or a new element) under the pointer is taken over again before the browser shows it.
    const observer = new MutationObserver(() => {
      if (!pointer) return;
      if (target?.isConnected && target.hasAttribute("title")) {
        const text = target.getAttribute("title")?.trim() ?? "";
        target.dataset.tip = target.getAttribute("title") ?? "";
        target.removeAttribute("title");
        setTip((current) => (current && text ? { ...current, text } : current));
        return;
      }
      const under = document.elementFromPoint(pointer.x, pointer.y)?.closest("[title]") as HTMLElement | null;
      if (under && under !== target) hover(under);
      else if (target && !target.isConnected) restore();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });

    const onLeave = () => {
      pointer = null;
      restore();
    };

    const onOut = (event: PointerEvent) => {
      if (!target) return;
      const to = event.relatedTarget as Node | null;
      if (to && target.contains(to)) return;
      restore();
    };

    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointermove", onMove, { capture: true, passive: true });
    document.addEventListener("pointerout", onOut, true);
    document.documentElement.addEventListener("pointerleave", onLeave);
    const onDown = () => {
      quiet = target;
      restore();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", restore, true);
    window.addEventListener("blur", onLeave);
    return () => {
      restore();
      observer.disconnect();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerout", onOut, true);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", restore, true);
      window.removeEventListener("blur", onLeave);
    };
  }, []);

  // Keep the bubble inside the window once its width is known.
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const element = bubble.current;
    if (!tip || !element) return setShift(0);
    const half = element.offsetWidth / 2;
    const left = tip.x - half;
    const right = tip.x + half;
    setShift(left < EDGE ? EDGE - left : right > window.innerWidth - EDGE ? window.innerWidth - EDGE - right : 0);
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={bubble}
      role="tooltip"
      className="tooltip-in pointer-events-none fixed z-[100] max-w-[280px] rounded-lg border border-app-hairline-strong bg-app-card/95 px-2.5 py-1.5 text-[12px] leading-snug text-app-ink shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)] backdrop-blur-md"
      style={{ left: tip.x + shift, top: tip.y, transform: `translate(-50%, ${tip.below ? "0" : "-100%"})` }}
    >
      {tip.text}
    </div>
  );
}
