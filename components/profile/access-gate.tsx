"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { DISCORD, SocialIcon } from "@/components/app/social-links";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { deployment } from "@/lib/deployment";
import { REFERRAL_CODE } from "@/lib/profile/identity";
import { useProfile } from "./profile-provider";

/** Invite codes are 8 characters (`lib/profile/store.ts`). */
const CODE_LENGTH = 8;

// Loaded only when the gate shows (it sits in the root layout): the slot animations stay out of every other page.
const CodeSlots = dynamic(() => import("@/components/fx/code-slots"), { ssr: false });

function Step({ index, label, state }: { index: number; label: string; state: "done" | "current" | "next" }) {
  return (
    <span className={`flex items-center gap-2 text-[12px] font-semibold ${state === "next" ? "text-app-faint" : "text-app-ink"}`}>
      <span
        className={`flex size-5 items-center justify-center rounded-full text-[11px] ${
          state === "done" ? "bg-app-accent text-app-on-accent" : state === "current" ? "bg-app-accent/15 text-app-accent ring-1 ring-app-accent/60" : "bg-app-chip text-app-faint"
        }`}
      >
        {state === "done" ? <Check className="size-3" strokeWidth={3} aria-hidden /> : index}
      </span>
      {label}
    </span>
  );
}

/**
 * Closed beta: every page but the home page asks for a connected wallet with access (an accepted invite, an admin, or
 * a profile that traded before the beta). A wallet without access joins with an invite code here, prefilled from a
 * `?ref=` link. If the profile can't be read the gate stays open rather than locking everyone out. The testnet site has
 * no gate: anyone can try it there.
 */
export function AccessGate() {
  const pathname = usePathname();
  const { id, profile, error, pendingReferral, applyReferral } = useProfile();
  const wallets = useWalletModal();
  const [code, setCode] = useState(pendingReferral?.toUpperCase() ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (pendingReferral) setCode(pendingReferral.toUpperCase());
  }, [pendingReferral]);

  // The wallet picker (and its signature prompts) open over the gate.
  if (deployment === "testnet" || pathname === "/" || wallets.isOpen) return null;
  const needsWallet = !id;
  const needsInvite = Boolean(id && profile && !profile.access);
  if (!needsWallet && !needsInvite) return null;
  // A wallet whose profile hasn't loaded (or failed to) isn't held at the gate.
  if (!needsWallet && (!profile || error)) return null;

  const join = async () => {
    setBusy(true);
    setMessage(await applyReferral(code.trim()));
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-xl">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="gate-aurora absolute -left-1/4 -top-1/3 h-[80vh] w-[80vw] rounded-full bg-[radial-gradient(closest-side,rgb(var(--app-accent)/0.16),transparent)]" />
        <div className="gate-aurora absolute -bottom-1/3 -right-1/4 h-[70vh] w-[70vw] rounded-full bg-[radial-gradient(closest-side,rgba(95,180,217,0.10),transparent)] [animation-delay:-9s]" />
      </div>

      <div role="dialog" aria-modal="true" aria-labelledby="access-gate-title" className="gate-rise relative flex w-full max-w-[460px] flex-col items-center text-center text-app-ink">
        <h2 id="access-gate-title" className="bg-linear-to-b from-white via-white to-app-accent bg-clip-text text-[38px] font-semibold leading-[1.05] tracking-tight text-transparent sm:text-[46px]">
          Trading, by invitation.
        </h2>
        <p className="mt-3 max-w-[380px] text-[14px] text-app-muted">Every perp DEX on one screen. Seats open one invite at a time.</p>

        <div className="relative mt-8 w-full rounded-[22px] p-[1.5px]">
          <div aria-hidden className="gate-edge absolute -inset-1 rounded-[26px] opacity-60 blur-lg" />
          <div aria-hidden className="gate-edge absolute inset-0 rounded-[22px]" />
          <div className="relative rounded-[20.5px] bg-[#0b0d10] p-5 sm:p-6">
            <div className="flex items-center justify-center gap-3">
              <Step index={1} label="Connect wallet" state={needsWallet ? "current" : "done"} />
              <span aria-hidden className="h-px w-8 bg-app-hairline-strong" />
              <Step index={2} label="Enter invite" state={needsWallet ? "next" : "current"} />
            </div>

            {needsWallet ? (
              <button
                type="button"
                onClick={wallets.open}
                className="group mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-[15px] font-semibold text-app-on-accent transition-transform hover:scale-[1.01] active:scale-[0.99]"
              >
                Connect wallet
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </button>
            ) : (
              <form
                className="mt-6"
                onSubmit={(event) => {
                  event.preventDefault();
                  void join();
                }}
              >
                <CodeSlots
                  length={CODE_LENGTH}
                  value={code}
                  onChange={setCode}
                  autoFocus
                  accentColor="rgb(var(--app-accent))"
                  status={message ? "error" : "idle"}
                  slotSize={44}
                  gap={8}
                  radius={12}
                  ariaLabel="Invite code"
                  className="justify-center"
                />
                {message && <p className="mt-3 text-[12px] text-app-down">{message}</p>}
                <button
                  type="submit"
                  disabled={busy || !REFERRAL_CODE.test(code.trim())}
                  className="group mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-app-accent text-[15px] font-semibold text-app-on-accent transition-all hover:shadow-[0_0_32px_rgb(var(--app-accent)/0.35)] disabled:opacity-40 disabled:shadow-none"
                >
                  {busy ? "Sign in your wallet…" : "Join Angler"}
                  {!busy && <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />}
                </button>
                <p className="mt-3 text-[11px] text-app-faint">One signature to accept the invite. No fee, no transaction.</p>
              </form>
            )}
          </div>
        </div>

        <p className="mt-6 text-[12px] text-app-muted">
          No invite yet? Traders on Angler earn one for every $10K they trade. {DISCORD ? "Ask for one on our Discord." : "Ask one."}
        </p>
        {DISCORD && (
          <a
            href={DISCORD.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl border border-app-hairline-strong px-3.5 text-[13px] font-semibold text-app-ink transition-colors hover:bg-white/5"
          >
            <SocialIcon id="discord" />
            Get an invite on Discord
          </a>
        )}
        <Link href="/" className="mt-3 text-[12px] font-semibold text-app-faint hover:text-app-ink">
          Back to home
        </Link>
      </div>
    </div>
  );
}
