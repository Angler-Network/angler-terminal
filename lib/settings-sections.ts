/** Settings page sections, in menu order; each has its own URL (`/settings/<id>`, General at `/settings`). */
export const settingsSections = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "layout", label: "Layout" },
  { id: "filters", label: "News filters" },
  { id: "rules", label: "News rules" },
  { id: "trading", label: "Trading" },
  { id: "venues", label: "Venues & networks" },
  { id: "notifications", label: "Notifications" },
  { id: "about", label: "About" },
] as const;

export type SettingsSectionId = (typeof settingsSections)[number]["id"];

export function readSettingsSection(segments: string[] | undefined): SettingsSectionId | null {
  if (!segments?.length) return "general";
  if (segments.length !== 1) return null;
  return settingsSections.find((section) => section.id === segments[0])?.id ?? null;
}

export const settingsHref = (id: SettingsSectionId) => (id === "general" ? "/settings" : `/settings/${id}`);
