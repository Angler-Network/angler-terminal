"use client";

import { useEffect, useState } from "react";
import {
  accentSwatches,
  cornerOptions,
  densityOptions,
  marketColorOptions,
  MAX_CUSTOM_CSS_LENGTH,
  styleOptions,
  themeOptions,
  type ThemeOption,
} from "@/lib/appearance";
import { useT } from "@/lib/i18n/client";
import { SegmentedControl, SettingRow, Toggle } from "./form-controls";
import { usePreferences } from "./preferences-provider";

const CUSTOM_CSS_DELAY_MS = 300;

const chipClass = (selected: boolean) =>
  `inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-[14px] text-app-ink transition-colors ${
    selected ? "border-app-ink bg-app-field" : "border-app-field-border bg-app-field/50 hover:bg-app-field"
  }`;

function AccentPicker() {
  const t = useT();
  const { preferences, updatePreference } = usePreferences();
  const isCustom = !accentSwatches.includes(preferences.accent);
  const swatchClass = (selected: boolean) =>
    `relative size-8 shrink-0 rounded-full border transition-transform hover:scale-110 ${
      selected ? "border-app-ink ring-2 ring-app-ink ring-offset-2 ring-offset-app-dialog" : "border-app-field-border"
    }`;

  return (
    <div role="radiogroup" aria-label={t("look.accent")} className="flex flex-wrap justify-end gap-2 sm:flex-nowrap">
      {accentSwatches.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={preferences.accent === color}
          aria-label={t("look.accentColor", { color })}
          onClick={() => updatePreference("accent", color)}
          style={{ background: color }}
          className={swatchClass(preferences.accent === color)}
        />
      ))}
      <label
        title={t("look.customColor")}
        className={`${swatchClass(isCustom)} cursor-pointer bg-[conic-gradient(#fb7185,#f5c97b,#34d399,#6ea8ff,#a78bfa,#fb7185)]`}
      >
        <span className="sr-only">{t("look.customColor")}</span>
        <input
          type="color"
          value={preferences.accent}
          onChange={(event) => updatePreference("accent", event.target.value.toLowerCase())}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

function ThemeChip({ theme }: { theme: ThemeOption }) {
  const { preferences, updatePreference } = usePreferences();
  const selected = preferences.theme === theme.value;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => updatePreference("theme", theme.value)}
      className={chipClass(selected)}
    >
      <span
        aria-hidden
        className="size-5 rounded-md border border-black/15"
        style={{ background: `linear-gradient(135deg, ${theme.canvas} 50%, ${theme.panel} 50%)` }}
      />
      {theme.label}
    </button>
  );
}

function CustomCssEditor() {
  const t = useT();
  const { preferences, updatePreference } = usePreferences();
  const [draft, setDraft] = useState(preferences.customCss);

  useEffect(() => {
    if (draft === preferences.customCss) return;
    const timer = window.setTimeout(() => updatePreference("customCss", draft), CUSTOM_CSS_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft, preferences.customCss, updatePreference]);

  return (
    <div className="py-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[15px] font-semibold text-app-ink">{t("look.css")}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-app-muted">{t("look.cssText")}</p>
        </div>
        {draft && (
          <button
            type="button"
            onClick={() => setDraft("")}
            className="shrink-0 text-[13px] font-medium text-app-muted hover:text-app-ink"
          >
            {t("look.clear")}
          </button>
        )}
      </div>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value.slice(0, MAX_CUSTOM_CSS_LENGTH))}
        spellCheck={false}
        rows={8}
        aria-label={t("look.css")}
        placeholder={":root {\n  --app-accent: 74 134 232;\n}"}
        className="scrollbar-subtle mt-3 w-full resize-y rounded-xl border border-app-field-border bg-app-card p-3 font-mono text-[13px] leading-relaxed text-app-ink outline-none placeholder:text-app-faint focus:border-app-focus focus:ring-4 focus:ring-app-ring/40"
      />
    </div>
  );
}

export function AppearanceSettings() {
  const t = useT();
  const { preferences, updatePreference } = usePreferences();

  return (
    <>
      <SettingRow title={t("look.accent")} description={t("look.accentText")}>
        <AccentPicker />
      </SettingRow>
      <SettingRow title={t("look.style")} description={t("look.styleText")}>
        <SegmentedControl
          label={t("look.style")}
          value={preferences.surfaceStyle}
          options={styleOptions.map((option) => ({ value: option.value, label: t(`style.${option.value}`) }))}
          onChange={(value) => updatePreference("surfaceStyle", value)}
        />
      </SettingRow>
      <div className="border-b border-app-line py-4">
        <p className="text-[15px] font-semibold text-app-ink">{t("look.background")}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-app-muted">{t("look.backgroundText")}</p>
        {(["dark", "light"] as const).map((tone) => (
          <div key={tone} className="mt-3 flex items-start gap-3">
            <span className="w-12 shrink-0 pt-2.5 text-[13px] text-app-muted">{t(`look.${tone}`)}</span>
            <div role="radiogroup" aria-label={t("look.backgrounds", { group: t(`look.${tone}`) })} className="flex flex-wrap gap-2">
              {themeOptions
                .filter((theme) => theme.tone === tone)
                .map((theme) => (
                  <ThemeChip key={theme.value} theme={theme} />
                ))}
            </div>
          </div>
        ))}
      </div>
      <SettingRow title={t("look.colors")} description={t("look.colorsText")}>
        <div role="radiogroup" aria-label={t("look.colors")} className="flex flex-wrap justify-end gap-2">
          {marketColorOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={preferences.marketColors === option.value}
              onClick={() => updatePreference("marketColors", option.value)}
              className={chipClass(preferences.marketColors === option.value)}
            >
              <span
                aria-hidden
                className="size-5 rounded-md"
                style={{ background: `linear-gradient(135deg, ${option.up} 50%, ${option.down} 50%)` }}
              />
              {t(`pair.${option.value}`)}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow title={t("look.density")} description={t("look.densityText")}>
        <SegmentedControl
          label={t("look.density")}
          value={preferences.density}
          options={densityOptions.map((option) => ({ value: option.value, label: t(`density.${option.value}`) }))}
          onChange={(value) => updatePreference("density", value)}
        />
      </SettingRow>
      <SettingRow title={t("look.corners")} description={t("look.cornersText")}>
        <SegmentedControl
          label={t("look.corners")}
          value={preferences.corners}
          options={cornerOptions.map((option) => ({ value: option.value, label: t(`corners.${option.value}`) }))}
          onChange={(value) => updatePreference("corners", value)}
        />
      </SettingRow>
      <SettingRow title={t("look.scrollbars")} description={t("look.scrollbarsText")}>
        <Toggle
          label={t("look.scrollbars")}
          checked={preferences.showScrollbars}
          onChange={(checked) => updatePreference("showScrollbars", checked)}
        />
      </SettingRow>
      <CustomCssEditor />
    </>
  );
}
