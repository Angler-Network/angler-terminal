"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { REFERRAL_CODE } from "@/lib/profile/identity";
import { useProfile } from "./profile-provider";

/**
 * Closed beta: every page but the home page asks for a connected wallet with access (an accepted invite, an admin, or
 * a profile that traded before the beta). A wallet without access joins with an invite code here, prefilled from a
 * `?ref=` link. If the profile can't be read the gate stays open rather than locking everyone out.
 */
export function AccessGate() {
  const pathname = usePathname();
  const { id, profile, error, pendingReferral, applyReferral } = useProfile();
  const wallets = useWalletModal();
  const [code, setCode] = useState(pendingReferral ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (pendingReferral) setCode(pendingReferral);
  }, [pendingReferral]);

  // The wallet picker (and its signature prompts) open over the gate.
  if (pathname === "/" || wallets.isOpen) return null;
  const needsWallet = !id;
  const needsInvite = Boolean(id && profile && !profile.access);
  if (!needsWallet && !needsInvite) return null;
  // A wallet whose profile hasn't loaded (or failed to) isn't held at the gate.
  if (!needsWallet && (!profile || error)) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
      <div role="dialog" aria-modal="true" aria-labelledby="access-gate-title" className="surface-menu w-full max-w-[400px] rounded-2xl border border-app-hairline-strong bg-app-card p-6 text-app-ink shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
        <span className="flex size-11 items-center justify-center rounded-xl bg-[#f5c97b]/15 text-[#f5c97b]">
          <KeyRound className="size-5" aria-hidden />
        </span>
        <h2 id="access-gate-title" className="mt-4 text-[20px] font-semibold tracking-tight">
          Angler is in closed beta
        </h2>
        {needsWallet ? (
          <>
            <p className="mt-1.5 text-[13px] text-app-muted">Connect your wallet. If you have an invite code, you&apos;ll enter it next.</p>
            <button type="button" onClick={wallets.open} className="mt-5 h-10 w-full rounded-xl bg-app-accent text-[14px] font-semibold text-app-on-accent">
              Connect wallet
            </button>
          </>
        ) : (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setMessage(await applyReferral(code.trim()));
              setBusy(false);
            }}
          >
            <p className="mt-1.5 text-[13px] text-app-muted">Enter the invite code a trader shared with you. One signature, no fee.</p>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="INVITE CODE"
              aria-label="Invite code"
              autoFocus
              className="mt-4 h-11 w-full rounded-xl border border-app-field-border bg-app-field px-3.5 text-center text-[16px] font-semibold tracking-[0.2em] text-app-ink outline-none placeholder:tracking-[0.15em] placeholder:text-app-faint focus:border-app-ink"
            />
            {message && <p className="mt-2 text-[12px] text-app-down">{message}</p>}
            <button
              type="submit"
              disabled={busy || !REFERRAL_CODE.test(code.trim())}
              className="mt-3 h-10 w-full rounded-xl bg-[#f5c97b] text-[14px] font-semibold text-black hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Sign in your wallet…" : "Join Angler"}
            </button>
          </form>
        )}
        <Link href="/" className="mt-4 block text-center text-[12px] font-semibold text-app-muted hover:text-app-ink">
          Back to home
        </Link>
      </div>
    </div>
  );
}
