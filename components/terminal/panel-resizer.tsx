"use client";

import { useRef } from "react";

const KEY_STEP = 24;

/**
 * Horizontal drag handle on a panel's top edge: dragging up makes the panel taller. Reports live heights while
 * dragging and the final one on release; double-click (or Home) asks for the automatic height again.
 */
export function PanelResizer({
  height,
  min,
  max,
  onResize,
  onCommit,
  onReset,
}: {
  height: number;
  min: number;
  /** Read on drag start, so it follows the window size. */
  max: () => number;
  onResize: (height: number) => void;
  onCommit: (height: number) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ startY: number; startHeight: number; max: number; last: number } | null>(null);
  const clamp = (value: number, upper: number) => Math.round(Math.min(Math.max(value, min), Math.max(min, upper)));

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize positions panel"
      aria-valuenow={height}
      aria-valuemin={min}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startY: event.clientY, startHeight: height, max: max(), last: height };
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state) return;
        state.last = clamp(state.startHeight + state.startY - event.clientY, state.max);
        onResize(state.last);
      }}
      onPointerUp={() => {
        const state = drag.current;
        drag.current = null;
        if (state) onCommit(state.last);
      }}
      onPointerCancel={() => {
        const state = drag.current;
        drag.current = null;
        if (state) onCommit(state.last);
      }}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === "Home") return onReset();
        const delta = event.key === "ArrowUp" ? KEY_STEP : event.key === "ArrowDown" ? -KEY_STEP : 0;
        if (!delta) return;
        event.preventDefault();
        onCommit(clamp(height + delta, max()));
      }}
      className="group absolute inset-x-0 -top-2 z-10 flex h-2 cursor-row-resize touch-none items-center justify-center outline-none max-lg:hidden"
    >
      <span className="h-1 w-12 rounded-full bg-app-ink/25 transition-colors group-hover:bg-app-accent group-focus-visible:bg-app-accent group-active:bg-app-accent" />
    </div>
  );
}
