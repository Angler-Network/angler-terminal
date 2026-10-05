export const languages = [
  { id: "en", name: "English" },
  { id: "tr", name: "Türkçe" },
  { id: "es", name: "Español" },
  { id: "pt", name: "Português" },
  { id: "fr", name: "Français" },
  { id: "de", name: "Deutsch" },
  { id: "ru", name: "Русский" },
  { id: "ja", name: "日本語" },
  { id: "zh", name: "简体中文" },
] as const;

export type Lang = (typeof languages)[number]["id"];

export const DEFAULT_LANG: Lang = "en";

export const LANG_COOKIE = "angler_lang";

export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const langTags: Record<Lang, string> = {
  en: "en-US",
  tr: "tr-TR",
  es: "es",
  pt: "pt-BR",
  fr: "fr",
  de: "de",
  ru: "ru",
  ja: "ja",
  zh: "zh-CN",
};

export function isLang(value: unknown): value is Lang {
  return languages.some((language) => language.id === value);
}

export function matchAcceptLanguage(header: string | null): Lang {
  if (!header) return DEFAULT_LANG;
  const preferred = header
    .split(",")
    .map((part) => {
      const [tag, quality] = part.trim().split(";q=");
      return { base: tag.toLowerCase().split("-")[0], quality: quality ? Number(quality) : 1 };
    })
    .sort((a, b) => b.quality - a.quality);
  const match = preferred.find((entry) => isLang(entry.base));
  return match ? (match.base as Lang) : DEFAULT_LANG;
}

export type TranslationVars = Record<string, string | number>;

export function interpolate(text: string, vars?: TranslationVars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
