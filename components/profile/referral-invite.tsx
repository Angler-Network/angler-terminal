"use client";

import { Gift, X } from "lucide-react";
import { useState } from "react";
import { shortAddress } from "@/lib/profile/identity";
import { useProfile } from "./profile-provider";

/**
 * Joining through a referral link: once a wallet that hasn't traded through Angler connects, it's asked once to accept
 * the invite (a signature). This is the only way to get a referrer; there's no code to type in later.
 */
export function ReferralInvite() {
  const { profile, pendingReferral, applyReferral, dismissReferral } = useProfile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only new profiles can join through a link (the server checks the same).
  const isNew = profile !== null && profile.points === 0 && !profile.referrer;
  if (!pendingReferral || !isNew) return null;
  const inviter = /^0x[0-9a-f]{40}$/i.test(pendingReferral) ? shortAddress(pendingReferral) : pendingReferral;

  return (
    <div
      role="dialog"
      aria-label="Referral invite"
      className="surface-menu fixed bottom-4 right-4 z-50 flex w-[min(360px,calc(100vw-2rem))] items-start gap-3 rounded-2xl border border-[#f5c97b]/30 bg-app-card p-3.5 text-app-ink shadow-[0_18px_40px_-16px_rgba(3,12,21,0.45)]"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f5c97b]/15 text-[#f5c97b]">
        <Gift className="size-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">{inviter} invited you</p>
        <p className="mt-0.5 text-[12px] text-app-muted">Join with their link to support them. One signature, no fee.</p>
        {error && <p className="mt-1 text-[12px] text-app-down">{error}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(await applyReferral(pendingReferral));
            setBusy(false);
          }}
          className="mt-2.5 h-8 rounded-lg bg-[#f5c97b] px-3 text-[12px] font-semibold text-black hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Sign in your wallet…" : "Accept invite"}
        </button>
      </div>
      <button type="button" onClick={dismissReferral} aria-label="Dismiss invite" className="rounded-md p-1 text-app-faint hover:text-app-ink">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
