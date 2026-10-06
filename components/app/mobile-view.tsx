"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

/** Below this width the terminal shows one view at a time with a bottom tab bar (Tailwind's `lg`). */
export const MOBILE_QUERY = "(max-width: 1023px)";

export type MobileView = "chart" | "trade" | "news" | "portfolio";

interface MobileViewContextValue {
  view: MobileView;
  setView: (view: MobileView) => void;
}

const MobileViewContext = createContext<MobileViewContextValue | null>(null);

export function MobileViewProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<MobileView>("chart");
  const value = useMemo(() => ({ view, setView }), [view]);
  return <MobileViewContext.Provider value={value}>{children}</MobileViewContext.Provider>;
}

export function useMobileView() {
  const context = useContext(MobileViewContext);
  if (!context) throw new Error("useMobileView must be used within MobileViewProvider");
  return context;
}

/** True on phone and tablet widths. False during server rendering and the first paint. */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isMobile;
}
