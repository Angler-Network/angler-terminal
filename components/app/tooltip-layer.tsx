"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const SHOW_DELAY_MS = 350;
const GAP = 8;
const EDGE = 8;

interface Tip {
  text: string;
  x: number;
  /** The element's top and bottom edges; the bubble sits above it unless it doesn't fit there. */
  top: number;
  bottom: number;
}

/**
 * Every `title` on the site shown as the app's own tooltip instead of the browser's: on hover the title moves to
 * `data-tip` (so the native one never shows) and comes back on leave. Mouse only; touch and keyboard keep the title
 * and aria labels as they are. One listener for the whole page, so no component has to opt in.
 * A component that re-renders under a still mouse can put the title back (React sets it again when the text changes,
 * or replaces the element, e.g. venue chips when quotes arrive), and the browser would show its own tooltip after all:
 * a MutationObserver watches `title` attributes and takes over whatever is under the pointer again.
 * The observer must never react to the layer's own title changes: with a titled element inside another (a venue logo
 * in a titled row), moving the title between them woke it again and again, a loop that froze the whole browser on
 * /swap. So its own changes are dropped (`takeRecords`), an element already taken over counts as "under the pointer"
 * (`[data-tip]`), and it checks at most once a frame.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let target: HTMLElement | null = null;
    let timer: number | undefined;
    // Declared before use: `own` drops the records our own title changes produce.
    let observer: MutationObserver | null = null;
    const own = (change: () => void) => {
      change();
      observer?.takeRecords();
    };

    const restore = () => {
      window.clearTimeout(timer);
      const previous = target;
      if (previous?.dataset.tip !== undefined) {
        own(() => {
          previous.setAttribute("title", previous.dataset.tip ?? "");
          delete previous.dataset.tip;
        });
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
      own(() => {
        next.dataset.tip = next.getAttribute("title") ?? "";
        next.removeAttribute("title");
      });
      timer = window.setTimeout(() => {
        if (target !== next || !next.isConnected) return;
        const rect = next.getBoundingClientRect();
        setTip({ text, x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom });
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
    let frame: number | undefined;
    const check = () => {
      frame = undefined;
      if (!pointer) return;
      const current = target;
      if (current?.isConnected && current.hasAttribute("title")) {
        const text = current.getAttribute("title")?.trim() ?? "";
        own(() => {
          current.dataset.tip = current.getAttribute("title") ?? "";
          current.removeAttribute("title");
        });
        setTip((shown) => (shown && text ? { ...shown, text } : shown));
        return;
      }
      // The element already taken over (title moved to data-tip) still counts, so an outer titled element never wins.
      const under = document.elementFromPoint(pointer.x, pointer.y)?.closest("[title], [data-tip]") as HTMLElement | null;
      if (under && under !== target && under.hasAttribute("title")) hover(under);
      else if (target && !target.isConnected) restore();
    };
    observer = new MutationObserver(() => {
      if (frame === undefined) frame = window.requestAnimationFrame(check);
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
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerout", onOut, true);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", restore, true);
      window.removeEventListener("blur", onLeave);
    };
  }, []);

  // Keep the bubble inside the window once its size is known: shifted sideways, and below the element when a long
  // (wrapped) text doesn't fit above it.
  const [shift, setShift] = useState(0);
  const [below, setBelow] = useState(false);
  // Measured before paint, so the bubble never flashes on the wrong side.
  useLayoutEffect(() => {
    const element = bubble.current;
    if (!tip || !element) {
      setShift(0);
      setBelow(false);
      return;
    }
    const half = element.offsetWidth / 2;
    const left = tip.x - half;
    const right = tip.x + half;
    setShift(left < EDGE ? EDGE - left : right > window.innerWidth - EDGE ? window.innerWidth - EDGE - right : 0);
    setBelow(tip.top - GAP - element.offsetHeight < EDGE);
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={bubble}
      role="tooltip"
      className="tooltip-in pointer-events-none fixed z-[100] w-max max-w-[280px] rounded-lg border border-app-hairline-strong bg-app-card/95 px-2.5 py-1.5 text-[12px] leading-snug text-app-ink shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)] backdrop-blur-md"
      style={{ left: tip.x + shift, top: below ? tip.bottom + GAP : tip.top - GAP, transform: `translate(-50%, ${below ? "0" : "-100%"})` }}
    >
      {tip.text}
    </div>
  );
}
