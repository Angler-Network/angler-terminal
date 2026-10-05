export type ThemeId =
  | "midnight"
  | "deepnavy"
  | "space-navy"
  | "graphite-violet"
  | "oled"
  | "navy-white"
  | "baby-navy"
  | "angler-navy";

export type SurfaceStyle = "solid" | "glass" | "liquid";

export type MarketColors = "green-red" | "blue-orange" | "teal-pink";

export type Density = "comfortable" | "compact";

export type Corners = "rounded" | "square";

export interface ThemeOption {
  value: ThemeId;
  label: string;
  tone: "dark" | "light";
  canvas: string;
  panel: string;
}

export const themeOptions: ThemeOption[] = [
  { value: "midnight", label: "Midnight", tone: "dark", canvas: "#070b11", panel: "#0e141c" },
  { value: "deepnavy", label: "Deepnavy", tone: "dark", canvas: "#030c15", panel: "#0a1623" },
  { value: "space-navy", label: "Space Navy", tone: "dark", canvas: "#13202e", panel: "#1a2a3a" },
  { value: "graphite-violet", label: "Graphite Violet", tone: "dark", canvas: "#08131d", panel: "#0e1b28" },
  { value: "oled", label: "OLED", tone: "dark", canvas: "#000000", panel: "#080808" },
  { value: "navy-white", label: "Navy White", tone: "light", canvas: "#eaf0f9", panel: "#f8fbff" },
  { value: "baby-navy", label: "Baby Navy", tone: "light", canvas: "#cedff6", panel: "#eaf2fd" },
  { value: "angler-navy", label: "Angler Navy", tone: "light", canvas: "#b6cff1", panel: "#dbe8fa" },
];

export const accentSwatches = ["#e9eff8", "#b6cff1", "#cedff6", "#6ea8ff", "#34d399", "#f5c97b", "#a78bfa", "#fb7185"];

export const styleOptions: { value: SurfaceStyle; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "glass", label: "Glass" },
  { value: "liquid", label: "Liquid" },
];

export const marketColorOptions: { value: MarketColors; label: string; up: string; down: string }[] = [
  { value: "green-red", label: "Green / Red", up: "#26a69a", down: "#ef5350" },
  { value: "blue-orange", label: "Blue / Orange", up: "#4c9aff", down: "#f59e0b" },
  { value: "teal-pink", label: "Teal / Pink", up: "#2dd4bf", down: "#f472b6" },
];

export const densityOptions: { value: Density; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

export const cornerOptions: { value: Corners; label: string }[] = [
  { value: "rounded", label: "Rounded" },
  { value: "square", label: "Square" },
];

export const MAX_CUSTOM_CSS_LENGTH = 20000;

export const CUSTOM_CSS_ELEMENT_ID = "angler-custom-css";

export interface Appearance {
  theme: ThemeId;
  accent: string;
  surfaceStyle: SurfaceStyle;
  marketColors: MarketColors;
  density: Density;
  corners: Corners;
  customCss: string;
}

export const defaultAppearance: Appearance = {
  theme: "deepnavy",
  accent: "#b6cff1",
  surfaceStyle: "solid",
  marketColors: "green-red",
  density: "comfortable",
  corners: "rounded",
  customCss: "",
};

function pick<T extends string>(options: { value: T }[], value: unknown, fallback: T): T {
  return options.find((option) => option.value === value)?.value ?? fallback;
}

export function readAppearance(stored: Record<string, unknown>): Appearance {
  return {
    theme: pick(themeOptions, stored.theme, defaultAppearance.theme),
    accent:
      typeof stored.accent === "string" && /^#[0-9a-f]{6}$/i.test(stored.accent)
        ? stored.accent.toLowerCase()
        : defaultAppearance.accent,
    surfaceStyle: pick(styleOptions, stored.surfaceStyle, defaultAppearance.surfaceStyle),
    marketColors: pick(marketColorOptions, stored.marketColors, defaultAppearance.marketColors),
    density: pick(densityOptions, stored.density, defaultAppearance.density),
    corners: pick(cornerOptions, stored.corners, defaultAppearance.corners),
    customCss: typeof stored.customCss === "string" ? stored.customCss.slice(0, MAX_CUSTOM_CSS_LENGTH) : "",
  };
}

export function applyAppearance(appearance: Partial<Appearance>, root: HTMLElement, styleId: string) {
  const dataset = root.dataset;
  const entries: [string, string | undefined, string][] = [
    // The terminal defaults to a dark theme while :root holds the light palette, so the theme is always set.
    ["theme", appearance.theme || "deepnavy", ""],
    ["surface", appearance.surfaceStyle, "solid"],
    ["density", appearance.density, "comfortable"],
    ["corners", appearance.corners, "rounded"],
  ];
  for (let index = 0; index < entries.length; index++) {
    const value = entries[index][1];
    if (value && value !== entries[index][2]) dataset[entries[index][0]] = value;
    else delete dataset[entries[index][0]];
  }

  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((start) => {
      const value = parseInt(hex.slice(start, start + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const channels = (hex: string) =>
    parseInt(hex.slice(1, 3), 16) + " " + parseInt(hex.slice(3, 5), 16) + " " + parseInt(hex.slice(5, 7), 16);

  const lightThemes = ["navy-white", "baby-navy", "angler-navy"];
  const isLight = lightThemes.indexOf(appearance.theme || "deepnavy") !== -1;
  if (isLight) delete dataset.tone;
  else dataset.tone = "dark";
  const chosen = typeof appearance.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(appearance.accent) ? appearance.accent : "#b6cff1";
  const accent = isLight && luminance(chosen) > 0.6 ? "#0b1320" : chosen;
  root.style.setProperty("--app-accent", channels(accent));
  root.style.setProperty("--app-on-accent", luminance(accent) > 0.35 ? "7 11 17" : "255 255 255");

  const pairs: Record<string, [string, string]> = {
    "green-red": ["#26a69a", "#ef5350"],
    "blue-orange": ["#4c9aff", "#f59e0b"],
    "teal-pink": ["#2dd4bf", "#f472b6"],
  };
  const pair = pairs[appearance.marketColors || "green-red"] || pairs["green-red"];
  root.style.setProperty("--app-up", channels(pair[0]));
  root.style.setProperty("--app-down", channels(pair[1]));

  const css = typeof appearance.customCss === "string" ? appearance.customCss : "";
  let element = document.getElementById(styleId);
  if (!css) {
    if (element) element.remove();
    return;
  }
  if (!element) {
    element = document.createElement("style");
    element.id = styleId;
    document.head.appendChild(element);
  }
  if (element.textContent !== css) element.textContent = css;
}
