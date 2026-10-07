import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SettingsView } from "@/components/app/settings-view";
import { readSettingsSection, settingsHref, settingsSections } from "@/lib/settings-sections";

export function generateStaticParams() {
  return settingsSections.map((section) => ({ section: section.id === "general" ? [] : [section.id] }));
}

export async function generateMetadata({ params }: { params: Promise<{ section?: string[] }> }): Promise<Metadata> {
  const section = readSettingsSection((await params).section) ?? "general";
  const label = settingsSections.find((entry) => entry.id === section)?.label;
  return {
    title: section === "general" ? "Settings" : `${label} · Settings`,
    // Per-browser preferences: nothing for search engines here.
    robots: { index: false },
    alternates: { canonical: settingsHref(section) },
  };
}

export default async function SettingsPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const section = readSettingsSection((await params).section);
  if (!section) notFound();
  return <SettingsView section={section} />;
}
