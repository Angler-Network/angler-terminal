"use client";

import { ChevronDown, ChevronRight, ChevronUp, PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { usePreferences } from "./preferences-provider";

/** Sidebar and top bar hide/reveal buttons, from angler-news (always available here, no setting gate). */

// No display utility here: each button sets its own (`hidden lg:inline-flex`), since two display classes on one
// element resolve by stylesheet order, which changed in Tailwind 4.
const iconButton =
  "size-9 items-center justify-center rounded-xl text-app-muted transition-colors hover:bg-app-card/70 hover:text-app-ink";

const IDLE_DELAY_MS = 5000;

// Solid, high-contrast tabs: they're the only way back to a hidden sidebar or top bar, so they must stand out.
const revealButton =
  "absolute z-30 items-center justify-center bg-app-accent text-app-on-accent shadow-[0_2px_12px_rgba(0,0,0,0.45)] transition-[opacity,filter] duration-300 hover:opacity-100 hover:brightness-110 focus-visible:opacity-100";

function useIdle(enabled: boolean) {
  const [isIdle, setIsIdle] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let timer = window.setTimeout(() => setIsIdle(true), IDLE_DELAY_MS);
    const wake = () => {
      setIsIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIsIdle(true), IDLE_DELAY_MS);
    };
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((event) => window.addEventListener(event, wake, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, wake));
      setIsIdle(false);
    };
  }, [enabled]);

  return isIdle;
}

export function SidebarToggle() {
  const { preferences, updatePreference } = usePreferences();
  return (
    <button
      type="button"
      onClick={() => updatePreference("showSidebar", !preferences.showSidebar)}
      aria-label={preferences.showSidebar ? "Hide sidebar" : "Show sidebar"}
      title={preferences.showSidebar ? "Hide sidebar" : "Show sidebar"}
      aria-pressed={!preferences.showSidebar}
      className={`${iconButton} hidden ${preferences.showSidebar ? "lg:inline-flex" : ""}`}
    >
      <PanelLeft className="size-[18px]" strokeWidth={1.75} />
    </button>
  );
}

export function TopBarToggle() {
  const { updatePreference } = usePreferences();
  return (
    <button type="button" onClick={() => updatePreference("showTopBar", false)} aria-label="Hide top bar" title="Hide top bar" className={`${iconButton} hidden lg:inline-flex`}>
      <ChevronUp className="size-[18px]" strokeWidth={1.75} />
    </button>
  );
}

export function LayoutRevealButtons() {
  const { preferences, updatePreference } = usePreferences();
  const isIdle = useIdle(!preferences.showSidebar || !preferences.showTopBar);
  // Idle tabs dim but never disappear, so they're still there to find.
  const visibility = isIdle ? "opacity-50" : "opacity-100";

  return (
    <>
      {!preferences.showSidebar && preferences.navMode !== "top" && (
        <button
          type="button"
          onClick={() => updatePreference("showSidebar", true)}
          aria-label="Show sidebar"
          title="Show sidebar"
          className={`${revealButton} ${visibility} left-0 top-1/2 hidden h-16 w-6 -translate-y-1/2 rounded-r-lg lg:inline-flex`}
        >
          <ChevronRight className="size-4" strokeWidth={2.5} aria-hidden />
        </button>
      )}
      {!preferences.showTopBar && (
        <button
          type="button"
          onClick={() => updatePreference("showTopBar", true)}
          aria-label="Show top bar"
          title="Show top bar"
          className={`${revealButton} ${visibility} left-1/2 top-0 inline-flex h-6 w-16 -translate-x-1/2 rounded-b-lg max-lg:hidden`}
        >
          <ChevronDown className="size-4" strokeWidth={2.5} aria-hidden />
        </button>
      )}
    </>
  );
}
