import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileView, type ProfileTab } from "@/components/profile/profile-view";

const titles: Record<ProfileTab, string> = { overview: "Profile", portfolio: "Portfolio", leaderboard: "Leaderboard", admin: "Admin" };

function readTab(segments: string[] | undefined): ProfileTab | null {
  if (!segments?.length) return "overview";
  if (segments.length === 1 && (segments[0] === "portfolio" || segments[0] === "leaderboard" || segments[0] === "admin")) return segments[0];
  return null;
}

export function generateStaticParams() {
  return [{ tab: [] }, { tab: ["portfolio"] }, { tab: ["leaderboard"] }, { tab: ["admin"] }];
}

export async function generateMetadata({ params }: { params: Promise<{ tab?: string[] }> }): Promise<Metadata> {
  const tab = readTab((await params).tab) ?? "overview";
  return {
    title: titles[tab],
    description: "Your Angler profile: username, points and level from your trading volume, your portfolio across venues and the leaderboard.",
    alternates: { canonical: tab === "overview" ? "/profile" : `/profile/${tab}` },
  };
}

export default async function ProfilePage({ params }: { params: Promise<{ tab?: string[] }> }) {
  const tab = readTab((await params).tab);
  if (!tab) notFound();
  return <ProfileView tab={tab} />;
}
