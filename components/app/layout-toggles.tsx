"use client";

import { ChevronDown, ChevronRight, ChevronUp, PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { usePreferences } from "./preferences-provider";

/** Sidebar and top bar hide/reveal buttons, from angler-news (always available here, no setting gate). */

const iconButton =
  "inline-flex size-9 items-center justify-center rounded-xl text-app-muted transition-colors hover:bg-app-card/70 hover:text-app-ink";

const IDLE_DELAY_MS = 5000;

const revealButton =
  "absolute z-30 inline-flex items-center justify-center border border-app-hairline-strong bg-app-card/90 text-app-muted shadow-sm transition-[opacity,color] duration-300 hover:text-app-ink hover:opacity-100 focus-visible:opacity-100";

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
  const visibility = isIdle ? "pointer-events-none opacity-0" : "opacity-60";

  return (
    <>
      {!preferences.showSidebar && preferences.navMode !== "top" && (
        <button
          type="button"
          onClick={() => updatePreference("showSidebar", true)}
          aria-label="Show sidebar"
          className={`${revealButton} ${visibility} left-0 top-1/2 hidden h-12 w-5 -translate-y-1/2 rounded-r-lg border-l-0 lg:inline-flex`}
        >
          <ChevronRight className="size-3.5" aria-hidden />
        </button>
      )}
      {!preferences.showTopBar && (
        <button
          type="button"
          onClick={() => updatePreference("showTopBar", true)}
          aria-label="Show top bar"
          className={`${revealButton} ${visibility} left-1/2 top-0 h-5 w-12 -translate-x-1/2 rounded-b-lg border-t-0 max-lg:hidden`}
        >
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      )}
    </>
  );
}
