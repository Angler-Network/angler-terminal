"use client";

import { FlaskConical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { welcomeSlides } from "./welcome-slides";

/** Bump the version when the tour or notice content changes so everyone sees it again. */
const ACK_KEY = "angler-terminal:alpha-ack:v2";
const OPEN_EVENT = "angler-terminal:welcome";

const points = [
  "This is an alpha prototype. Expect bugs, missing features and changes without notice.",
  "Hyperliquid runs on testnet by default (mock funds). Jupiter swaps are on Solana mainnet and use real funds.",
  "Start with small sizes and double-check every confirmation in your wallet.",
  "Not financial advice. Impact scores and sentiment are model outputs and can be wrong.",
];

/** Opens the welcome tour again (Settings → About). */
export function openWelcomeTour() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function AlphaStep() {
  return (
    <>
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
    </>
  );
}

function SlideStep({ index }: { index: number }) {
  const slide = welcomeSlides[index];
  const Icon = slide.icon;
  const isFirst = index === 0;
  return (
    <>
      <div className={`flex gap-3 ${isFirst ? "flex-col items-start pt-2" : "items-center"}`}>
        <span className={`inline-flex items-center justify-center rounded-xl bg-app-accent/15 text-app-accent ${isFirst ? "size-12" : "size-10"}`}>
          <Icon className={isFirst ? "size-6" : "size-5"} aria-hidden />
        </span>
        <h2 id="alpha-notice-title" className={`font-semibold ${isFirst ? "text-[24px] leading-tight" : "text-[18px]"}`}>
          {slide.title}
        </h2>
      </div>
      <p className={`leading-relaxed text-app-muted ${isFirst ? "text-[15px]" : "text-[14px]"}`}>{slide.intro}</p>
      {slide.points.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {slide.points.map((point) => (
            <li key={point} className="flex gap-2.5 text-[14px] leading-snug text-app-ink/90">
              <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-app-accent" />
              {point}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Welcome tour, then the alpha notice, once per browser on the first visit; "I understand" on the last step stores
 * the acknowledgement. Slide copy lives in welcome-slides.ts.
 */
export function AlphaNotice() {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const alphaStep = welcomeSlides.length;
  const isAlpha = step === alphaStep;

  useEffect(() => {
    try {
      if (localStorage.getItem(ACK_KEY) !== "1") setIsOpen(true);
    } catch {
      setIsOpen(true);
    }
    const reopen = () => {
      setStep(0);
      setIsOpen(true);
    };
    window.addEventListener(OPEN_EVENT, reopen);
    return () => window.removeEventListener(OPEN_EVENT, reopen);
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
      className="surface-menu m-auto w-[min(500px,calc(100vw-2rem))] max-w-none rounded-3xl border border-app-card/70 bg-app-dialog p-0 font-sans text-app-ink shadow-[0_30px_80px_-20px_rgba(3,12,21,0.6)] backdrop:bg-[#030c15]/65 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex min-h-[380px] flex-col gap-4 p-6">
        {isAlpha ? <AlphaStep /> : <SlideStep index={step} />}
        <div className="mt-auto flex items-center gap-3 pt-2">
          <div aria-label={`Step ${step + 1} of ${alphaStep + 1}`} className="flex gap-1.5">
            {Array.from({ length: alphaStep + 1 }, (_, index) => (
              <button
                key={index}
                type="button"
                aria-label={`Go to step ${index + 1}`}
                aria-current={index === step ? "step" : undefined}
                onClick={() => setStep(index)}
                className={`h-1.5 rounded-full transition-all ${index === step ? "w-5 bg-app-ink" : "w-1.5 bg-app-hairline-strong hover:bg-app-muted"}`}
              />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!isAlpha && (
              <button type="button" onClick={() => setStep(alphaStep)} className="h-10 px-2 text-[13px] font-semibold text-app-muted hover:text-app-ink">
                Skip
              </button>
            )}
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="h-10 rounded-xl border border-app-hairline-strong px-4 text-[14px] font-semibold text-app-ink hover:bg-app-chip"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={isAlpha ? acknowledge : () => setStep(step + 1)}
              autoFocus
              className="h-10 rounded-xl bg-app-accent px-5 text-[14px] font-semibold text-app-on-accent transition-colors hover:bg-app-accent/85"
            >
              {isAlpha ? "I understand" : step === 0 ? "Get started" : "Next"}
            </button>
          </div>
        </div>
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
