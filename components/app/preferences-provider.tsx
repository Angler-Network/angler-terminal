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
  openSettings: () => void;
  closeSettings: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error("usePreferences must be used within PreferencesProvider");
  return context;
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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
  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);

  const value = useMemo(
    () => ({ preferences, isLoaded, updatePreference, isSettingsOpen, openSettings, closeSettings }),
    [preferences, isLoaded, updatePreference, isSettingsOpen, openSettings, closeSettings],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
