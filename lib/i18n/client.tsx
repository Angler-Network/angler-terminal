"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { interpolate, type Lang } from "./config";
import { en, type AllMessages } from "./messages/en";
import type { Translate } from "./types";

export type { Translate } from "./types";

interface I18nContextValue {
  lang: Lang;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useT must be used within I18nProvider");
  return context;
}

export function useT() {
  return useI18n().t;
}

export function useLang() {
  return useI18n().lang;
}

interface I18nProviderProps {
  lang?: Lang;
  messages?: AllMessages;
  children: React.ReactNode;
}

export function I18nProvider({ lang = "en", messages = en, children }: I18nProviderProps) {
  const t = useCallback<Translate>((key, vars) => interpolate(messages[key] ?? key, vars), [messages]);
  const value = useMemo(() => ({ lang, t }), [lang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
