"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  applyPreferencesToDocument,
  defaultPreferences,
  parsePreferences,
  PREFERENCES_STORAGE_KEY,
  type Preferences,
} from "@/lib/preferences";

interface PreferencesContextValue {
  preferences: Preferences;
  isLoaded: boolean;
  updatePreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  /** Whether the settings page is showing. */
  isSettingsOpen: boolean;
  /** Goes to the settings page, on a section (`/settings/rules`) when given. */
  openSettings: (section?: string) => void;
  /** Leaves the settings page for the page the user came from (the terminal when they landed on it). */
  closeSettings: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error("usePreferences must be used within PreferencesProvider");
  return context;
}

/**
 * `initial` comes from the server's cookies (the chart's asset and price source), so the server render and the first
 * client render agree before the saved preferences load from localStorage.
 */
export function PreferencesProvider({ children, initial }: { children: React.ReactNode; initial?: Partial<Preferences> }) {
  const [preferences, setPreferences] = useState(() => (initial ? { ...defaultPreferences, ...initial } : defaultPreferences));
  const [isLoaded, setIsLoaded] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const isSettingsOpen = pathname.startsWith("/settings");
  // Where closing the settings page returns to.
  const returnTo = useRef("/perp");
  useEffect(() => {
    if (!isSettingsOpen) returnTo.current = pathname;
  }, [pathname, isSettingsOpen]);

  useEffect(() => {
    try {
      setPreferences(parsePreferences(localStorage.getItem(PREFERENCES_STORAGE_KEY)));
    } catch {}
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;

    try {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    } catch {}

    applyPreferencesToDocument(preferences);
  }, [preferences, isLoaded]);

  const updatePreference = useCallback<PreferencesContextValue["updatePreference"]>(
    (key, value) => setPreferences((current) => ({ ...current, [key]: value })),
    [],
  );
  const openSettings = useCallback((section?: string) => router.push(section ? `/settings/${section}` : "/settings"), [router]);
  const closeSettings = useCallback(() => router.push(returnTo.current), [router]);

  const value = useMemo(
    () => ({ preferences, isLoaded, updatePreference, isSettingsOpen, openSettings, closeSettings }),
    [preferences, isLoaded, updatePreference, isSettingsOpen, openSettings, closeSettings],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
