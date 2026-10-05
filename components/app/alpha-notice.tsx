"use client";

import { FlaskConical } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Bump the version when the notice content changes so everyone sees it again. */
const ACK_KEY = "angler-terminal:alpha-ack:v1";

const points = [
  "This is an alpha prototype. Expect bugs, missing features and changes without notice.",
  "Hyperliquid runs on testnet by default (mock funds). Jupiter swaps are on Solana mainnet and use real funds.",
  "Start with small sizes and double-check every confirmation in your wallet.",
  "Not financial advice. Impact scores and sentiment are model outputs and can be wrong.",
];

/** Shown once per browser on the first visit; "I understand" stores the acknowledgement. */
export function AlphaNotice() {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(ACK_KEY) !== "1") setIsOpen(true);
    } catch {
      setIsOpen(true);
    }
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const acknowledge = () => {
    try {
      localStorage.setItem(ACK_KEY, "1");
    } catch {}
    setIsOpen(false);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="alpha-notice-title"
      // Escape closes it for this visit only; it comes back until acknowledged.
      onClose={() => setIsOpen(false)}
      className="surface-menu m-auto w-[min(460px,calc(100vw-2rem))] max-w-none rounded-3xl border border-app-card/70 bg-app-dialog p-0 font-sans text-app-ink shadow-[0_30px_80px_-20px_rgba(3,12,21,0.6)] backdrop:bg-[#030c15]/65 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-[#fbefd6] text-[#87500a]">
            <FlaskConical className="size-5" aria-hidden />
          </span>
          <div>
            <h2 id="alpha-notice-title" className="text-[18px] font-semibold">
              Angler Terminal is in alpha
            </h2>
            <p className="text-[13px] text-app-muted">Please read before trading.</p>
          </div>
        </div>
        <ul className="flex flex-col gap-2.5">
          {points.map((point) => (
            <li key={point} className="flex gap-2.5 text-[14px] leading-snug text-app-ink/90">
              <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[#f5a524]" />
              {point}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={acknowledge}
          autoFocus
          className="mt-1 h-11 rounded-xl bg-app-accent text-[15px] font-semibold text-app-on-accent transition-colors hover:bg-app-accent/85"
        >
          I understand
        </button>
      </div>
    </dialog>
  );
}

/** Small persistent marker next to the ticker. */
export function AlphaBadge() {
  return (
    <span
      title="Alpha prototype: expect bugs. Not financial advice."
      className="shrink-0 rounded-md bg-[#fbefd6] px-1.5 py-[3px] text-[10px] font-semibold uppercase leading-none tracking-[0.08em] text-[#87500a]"
    >
      Alpha
    </span>
  );
}
