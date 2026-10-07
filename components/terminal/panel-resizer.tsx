"use client";

import { useRef } from "react";

const KEY_STEP = 24;

/** The panel edge the handle sits on; dragging away from the panel makes it bigger. */
export type ResizeEdge = "top" | "left" | "right";

const edgeClass: Record<ResizeEdge, string> = {
  top: "inset-x-0 -top-2 h-2 cursor-row-resize",
  left: "inset-y-0 -left-2 w-2 cursor-col-resize",
  right: "inset-y-0 -right-2 w-2 cursor-col-resize",
};

const gripClass: Record<ResizeEdge, string> = { top: "h-1 w-12", left: "h-12 w-1", right: "h-12 w-1" };

/** Keys that grow the panel, per edge (the opposite arrow shrinks it). */
const growKey: Record<ResizeEdge, [grow: string, shrink: string]> = {
  top: ["ArrowUp", "ArrowDown"],
  left: ["ArrowLeft", "ArrowRight"],
  right: ["ArrowRight", "ArrowLeft"],
};

/**
 * Drag handle on a panel's edge, in the grid gap next to it. Reports live sizes while dragging and the final one
 * on release; double-click (or Home) asks for the automatic size again.
 */
export function PanelResizer({
  edge = "top",
  label,
  size,
  min,
  max,
  onResize,
  onCommit,
  onReset,
}: {
  edge?: ResizeEdge;
  label: string;
  /** The panel's current size in px, read when a drag or key press starts. */
  size: () => number;
  min: number;
  /** Read on drag start, so it follows the window size. */
  max: () => number;
  onResize: (size: number) => void;
  onCommit: (size: number) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ start: number; startSize: number; max: number; last: number } | null>(null);
  const clamp = (value: number, upper: number) => Math.round(Math.min(Math.max(value, min), Math.max(min, upper)));
  const position = (event: React.PointerEvent) => (edge === "top" ? event.clientY : event.clientX);
  // Pixels moved away from the panel.
  const moved = (from: number, to: number) => (edge === "right" ? to - from : from - to);
  const finish = () => {
    const state = drag.current;
    drag.current = null;
    if (state) onCommit(state.last);
  };

  return (
    <div
      role="separator"
      aria-orientation={edge === "top" ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuemin={min}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const current = size();
        drag.current = { start: position(event), startSize: current, max: max(), last: current };
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state) return;
        state.last = clamp(state.startSize + moved(state.start, position(event)), state.max);
        onResize(state.last);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === "Home") return onReset();
        const [grow, shrink] = growKey[edge];
        const delta = event.key === grow ? KEY_STEP : event.key === shrink ? -KEY_STEP : 0;
        if (!delta) return;
        event.preventDefault();
        onCommit(clamp(size() + delta, max()));
      }}
      className={`group absolute z-10 flex touch-none items-center justify-center outline-hidden max-lg:hidden ${edgeClass[edge]}`}
    >
      <span
        // Side grips only show on hover: three always-on bars beside the columns would be noise.
        className={`rounded-full bg-app-ink/25 transition group-hover:bg-app-accent group-hover:opacity-100 group-focus-visible:bg-app-accent group-focus-visible:opacity-100 group-active:bg-app-accent group-active:opacity-100 ${gripClass[edge]} ${edge === "top" ? "" : "opacity-0"}`}
      />
    </div>
  );
}
