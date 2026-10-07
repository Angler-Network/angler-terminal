"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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
  isSettingsOpen: boolean;
  /** Section the settings dialog opens on (set by openSettings). */
  settingsSection: string | null;
  openSettings: (section?: string) => void;
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string | null>(null);

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
  const openSettings = useCallback((section?: string) => {
    setSettingsSection(section ?? null);
    setIsSettingsOpen(true);
  }, []);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);

  const value = useMemo(
    () => ({ preferences, isLoaded, updatePreference, isSettingsOpen, settingsSection, openSettings, closeSettings }),
    [preferences, isLoaded, updatePreference, isSettingsOpen, settingsSection, openSettings, closeSettings],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
