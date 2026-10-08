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

    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const next = (event.target as Element | null)?.closest?.("[title]") as HTMLElement | null;
      if (next === target) return;
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

    const onOut = (event: PointerEvent) => {
      if (!target) return;
      const to = event.relatedTarget as Node | null;
      if (to && target.contains(to)) return;
      restore();
    };

    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("pointerdown", restore, true);
    window.addEventListener("scroll", restore, true);
    window.addEventListener("blur", restore);
    return () => {
      restore();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("pointerdown", restore, true);
      window.removeEventListener("scroll", restore, true);
      window.removeEventListener("blur", restore);
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
