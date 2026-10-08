"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useWalletModal } from "@/components/terminal/wallet-modal";
import { REFERRAL_CODE } from "@/lib/profile/identity";
import { useProfile } from "./profile-provider";

/** Invite codes are 8 characters (`lib/profile/store.ts`). */
const CODE_LENGTH = 8;

function Step({ index, label, state }: { index: number; label: string; state: "done" | "current" | "next" }) {
  return (
    <span className={`flex items-center gap-2 text-[12px] font-semibold ${state === "next" ? "text-app-faint" : "text-app-ink"}`}>
      <span
        className={`flex size-5 items-center justify-center rounded-full text-[11px] ${
          state === "done" ? "bg-[#f5c97b] text-black" : state === "current" ? "bg-[#f5c97b]/15 text-[#f5c97b] ring-1 ring-[#f5c97b]/60" : "bg-app-chip text-app-faint"
        }`}
      >
        {state === "done" ? <Check className="size-3" strokeWidth={3} aria-hidden /> : index}
      </span>
      {label}
    </span>
  );
}

/** One box per character over a single real input, so typing, pasting and mobile keyboards all just work. */
function CodeInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <div className="relative" onClick={() => inputRef.current?.focus()}>
      <div aria-hidden className="grid grid-cols-8 gap-1.5 sm:gap-2">
        {Array.from({ length: CODE_LENGTH }, (_, index) => {
          const char = value[index];
          const current = focused && index === Math.min(value.length, CODE_LENGTH - 1);
          return (
            <span
              key={index}
              className={`flex aspect-[4/5] items-center justify-center rounded-xl border text-[20px] font-semibold transition-all duration-150 ${
                current
                  ? "border-[#f5c97b] bg-[#f5c97b]/[0.07] shadow-[0_0_0_4px_rgba(245,201,123,0.12)]"
                  : char
                    ? "border-app-hairline-strong bg-app-card text-app-ink"
                    : "border-app-hairline bg-app-field"
              }`}
            >
              {char ?? (current ? <span className="h-6 w-px animate-pulse bg-[#f5c97b]" /> : "")}
            </span>
          );
        })}
      </div>
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label="Invite code"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        className="absolute inset-0 cursor-text opacity-0"
      />
    </div>
  );
}

/**
 * Closed beta: every page but the home page asks for a connected wallet with access (an accepted invite, an admin, or
 * a profile that traded before the beta). A wallet without access joins with an invite code here, prefilled from a
 * `?ref=` link. If the profile can't be read the gate stays open rather than locking everyone out.
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
  if (pathname === "/" || wallets.isOpen) return null;
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
        <div className="gate-aurora absolute -left-1/4 -top-1/3 h-[80vh] w-[80vw] rounded-full bg-[radial-gradient(closest-side,rgba(245,201,123,0.16),transparent)]" />
        <div className="gate-aurora absolute -bottom-1/3 -right-1/4 h-[70vh] w-[70vw] rounded-full bg-[radial-gradient(closest-side,rgba(95,180,217,0.10),transparent)] [animation-delay:-9s]" />
      </div>

      <div role="dialog" aria-modal="true" aria-labelledby="access-gate-title" className="gate-rise relative flex w-full max-w-[460px] flex-col items-center text-center text-app-ink">
        <h2 id="access-gate-title" className="bg-linear-to-b from-white via-white to-[#f5c97b] bg-clip-text text-[38px] font-semibold leading-[1.05] tracking-tight text-transparent sm:text-[46px]">
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
                className="group mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-[15px] font-semibold text-black transition-transform hover:scale-[1.01] active:scale-[0.99]"
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
                <CodeInput value={code} onChange={setCode} />
                {message && <p className="mt-3 text-[12px] text-app-down">{message}</p>}
                <button
                  type="submit"
                  disabled={busy || !REFERRAL_CODE.test(code.trim())}
                  className="group mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#f5c97b] text-[15px] font-semibold text-black transition-all hover:shadow-[0_0_32px_rgba(245,201,123,0.35)] disabled:opacity-40 disabled:shadow-none"
                >
                  {busy ? "Sign in your wallet…" : "Join Angler"}
                  {!busy && <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />}
                </button>
                <p className="mt-3 text-[11px] text-app-faint">One signature to accept the invite. No fee, no transaction.</p>
              </form>
            )}
          </div>
        </div>

        <p className="mt-6 text-[12px] text-app-muted">No invite yet? Traders on Angler earn one for every $10K they trade. Ask one.</p>
        <Link href="/" className="mt-3 text-[12px] font-semibold text-app-faint hover:text-app-ink">
          Back to home
        </Link>
      </div>
    </div>
  );
}
