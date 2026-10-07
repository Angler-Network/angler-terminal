"use client";

import { ChevronDown, UserRound, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LayoutMenu } from "@/components/app/layout-menu";
import { ConnectButton } from "@/components/terminal/connect-button";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { shortAddress } from "@/lib/profile/identity";
import { ProfileAvatar } from "./profile-avatar";
import { useProfile } from "./profile-provider";

const tile =
  "flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-[11px] font-semibold text-app-ink transition-colors hover:bg-app-chip";

/**
 * Top bar account control: "Connect" until a wallet connects, then one button with the profile's avatar, name and
 * level that drops down to Profile, Wallets and Layout (one control instead of a profile and a wallet button).
 */
export function ProfileButton() {
  const { id, profile, pendingReferral } = useProfile();
  const wallets = useWalletModal();
  const active = usePathname().startsWith("/profile");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!id) return <ConnectButton />;
  const shownId = profile?.id ?? id;
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title="Profile, wallets and layout"
        className={`inline-flex h-8 items-center gap-2 rounded-lg border px-1.5 text-[12px] font-medium transition-colors sm:pr-2 ${
          active || open ? "border-app-accent/50 bg-app-card text-app-ink" : "border-app-hairline-strong bg-app-card/60 text-app-ink hover:bg-app-card"
        }`}
      >
        <ProfileAvatar id={shownId} size={22} />
        <span className="hidden max-w-[120px] truncate sm:inline">{profile?.username ?? shortAddress(shownId)}</span>
        {profile && (
          <span title={`${profile.level.name} · ${profile.points.toLocaleString("en-US", { maximumFractionDigits: 2 })} points`} className="hidden rounded-md bg-app-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-app-accent sm:inline">
            Lv {profile.level.level}
          </span>
        )}
        {pendingReferral && <span title="A referral code is waiting on your profile" className="size-1.5 rounded-full bg-[#f5c97b]" />}
        <ChevronDown className={`hidden size-3.5 text-app-muted transition-transform sm:block ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="surface-menu absolute right-0 top-full z-50 mt-2 grid w-64 grid-cols-3 gap-1 rounded-2xl border border-app-hairline-strong bg-app-dialog p-1.5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)]">
          <Link href="/profile" role="menuitem" onClick={() => setOpen(false)} className={tile}>
            <UserRound className="size-5" strokeWidth={1.75} aria-hidden />
            Profile
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              wallets.open();
            }}
            className={tile}
          >
            <Wallet className="size-5" strokeWidth={1.75} aria-hidden />
            Wallets
          </button>
          <LayoutMenu placement="below" className={tile} labelNode={<span>Layout</span>} />
        </div>
      )}
    </div>
  );
}
