"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { shortAddress } from "@/lib/profile/identity";
import { ProfileAvatar } from "./profile-avatar";
import { useProfile } from "./profile-provider";

/** Top bar: the connected wallet's avatar, name and level, linking to the profile page. Hidden until a wallet connects. */
export function ProfileButton() {
  const { id, profile } = useProfile();
  const active = usePathname().startsWith("/profile");
  if (!id) return null;
  const shownId = profile?.id ?? id;
  return (
    <Link
      href="/profile"
      title="Profile, points and portfolio"
      aria-current={active ? "page" : undefined}
      className={`inline-flex h-8 items-center gap-2 rounded-lg border px-1.5 text-[12px] font-medium transition-colors sm:pr-2.5 ${
        active ? "border-app-accent/50 bg-app-card text-app-ink" : "border-app-hairline-strong bg-app-card/60 text-app-ink hover:bg-app-card"
      }`}
    >
      <ProfileAvatar id={shownId} size={22} />
      <span className="hidden max-w-[120px] truncate sm:inline">{profile?.username ?? shortAddress(shownId)}</span>
      {profile && (
        <span title={`${profile.level.name} · ${profile.points.toLocaleString("en-US")} points`} className="hidden rounded-md bg-app-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-app-accent sm:inline">
          Lv {profile.level.level}
        </span>
      )}
    </Link>
  );
}
