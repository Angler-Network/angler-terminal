"use client";

import { Check, FlaskConical } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { accentSwatches, themeOptions } from "@/lib/appearance";
import { layoutPresets, navModeChange, panelNames, type NavMode, type TapePosition, type TerminalPanels } from "@/lib/preferences";
import { usePreferences } from "./preferences-provider";

/** Bump the version when the onboarding changes so everyone sees it again. */
const ACK_KEY = "angler-terminal:alpha-ack:v3";
const OPEN_EVENT = "angler-terminal:welcome";

const points = [
  "Alpha prototype: expect bugs and changes.",
  "Perps run on testnet by default (mock funds). Jupiter swaps use real funds on Solana.",
  "Not financial advice. Scores are model outputs.",
];

/** Opens the onboarding again (Settings → About). */
export function openWelcomeTour() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function WelcomeStep() {
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <Image src="/blacklogo.png" alt="" width={56} height={56} className="[html[data-tone=dark]_&]:hidden" />
      <Image src="/whitelogo.png" alt="" width={56} height={56} className="hidden [html[data-tone=dark]_&]:block" />
      <h2 id="alpha-notice-title" className="text-[26px] font-semibold leading-tight">
        Welcome to Angler Terminal
      </h2>
      <p className="max-w-[340px] text-[15px] leading-relaxed text-app-muted">Every perp DEX on one screen, with AI-scored news you can trade in two taps.</p>
    </div>
  );
}

/** Theme, accent and framed or full-screen design, applied live (the same settings as Appearance). */
function LookStep() {
  const { preferences, updatePreference } = usePreferences();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 id="alpha-notice-title" className="text-[20px] font-semibold">
          Make it yours
        </h2>
        <p className="mt-1 text-[13px] text-app-muted">Pick a theme and an accent. Everything else is in Settings → Appearance.</p>
      </div>
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Theme">
        {themeOptions.map((theme) => {
          const active = preferences.theme === theme.value;
          return (
            <button
              key={theme.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => updatePreference("theme", theme.value)}
              className={`flex flex-col gap-1.5 rounded-xl border p-1.5 text-left transition-colors ${active ? "border-app-accent" : "border-app-hairline hover:border-app-hairline-strong"}`}
            >
              <span className="flex h-9 overflow-hidden rounded-lg border border-black/10" style={{ background: theme.canvas }}>
                <span className="m-1.5 ml-auto w-1/2 rounded-md" style={{ background: theme.panel }} />
              </span>
              <span className="truncate px-0.5 text-[11px] font-semibold text-app-ink">{theme.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Accent">
        <span className="mr-1 text-[12px] font-semibold text-app-muted">Accent</span>
        {accentSwatches.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={preferences.accent === color}
            aria-label={color}
            onClick={() => updatePreference("accent", color)}
            className={`size-7 rounded-full border-2 transition-transform hover:scale-110 ${preferences.accent === color ? "border-app-ink" : "border-transparent"}`}
            style={{ background: color }}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Design">
        {[
          { framed: true, label: "Framed", hint: "Rounded frame with an inset" },
          { framed: false, label: "Full screen", hint: "Edge to edge" },
        ].map((option) => {
          const active = preferences.framedLayout === option.framed;
          return (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => updatePreference("framedLayout", option.framed)}
              className={`flex items-center gap-3 rounded-xl border p-2 text-left transition-colors ${active ? "border-app-accent bg-app-accent/10" : "border-app-hairline hover:bg-app-chip"}`}
            >
              <span className={`flex h-10 w-14 shrink-0 bg-app-chip ${option.framed ? "rounded-lg p-1" : "rounded-sm"}`}>
                <span className={`flex-1 border border-app-hairline-strong bg-app-card ${option.framed ? "rounded-md" : ""}`} />
              </span>
              <span>
                <span className="block text-[13px] font-semibold text-app-ink">{option.label}</span>
                <span className="block text-[11px] text-app-muted">{option.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Navigation">
        {(
          [
            { mode: "sidebar", label: "Sidebar", hint: "Menu on the left" },
            { mode: "top", label: "Top bar", hint: "Menu on top, full width" },
          ] as Array<{ mode: NavMode; label: string; hint: string }>
        ).map((option) => {
          const active = preferences.navMode === option.mode;
          return (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                const next = navModeChange(option.mode, preferences.tapePosition);
                updatePreference("navMode", next.navMode);
                updatePreference("tapePosition", next.tapePosition);
              }}
              className={`flex items-center gap-3 rounded-xl border p-2 text-left transition-colors ${active ? "border-app-accent bg-app-accent/10" : "border-app-hairline hover:bg-app-chip"}`}
            >
              <span className={`flex h-10 w-14 shrink-0 gap-0.5 overflow-hidden rounded-md bg-app-chip p-0.5 ${option.mode === "top" ? "flex-col" : ""}`}>
                <span className={`rounded-sm bg-app-hairline-strong ${option.mode === "top" ? "h-1.5" : "w-2"}`} />
                <span className="flex-1 rounded-sm border border-app-hairline-strong bg-app-card" />
              </span>
              <span>
                <span className="block text-[13px] font-semibold text-app-ink">{option.label}</span>
                <span className="block text-[11px] text-app-muted">{option.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3" role="radiogroup" aria-label="Price tape">
        <span className="text-[12px] font-semibold text-app-muted">Price tape</span>
        <div className="flex flex-1 gap-0.5 rounded-lg bg-app-chip p-0.5">
          {(
            [
              { value: "top", label: "Top" },
              { value: "bottom", label: "Bottom" },
              { value: "off", label: "Off" },
            ] as Array<{ value: TapePosition; label: string }>
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={preferences.tapePosition === option.value}
              onClick={() => updatePreference("tapePosition", option.value)}
              className={`h-7 flex-1 rounded-md text-[12px] font-semibold ${
                preferences.tapePosition === option.value ? "bg-app-card text-app-ink shadow-sm" : "text-app-muted hover:text-app-ink"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function samePanels(a: TerminalPanels, b: TerminalPanels) {
  return (Object.keys(a) as Array<keyof TerminalPanels>).every((key) => a[key] === b[key]);
}

/** Asks what the user wants to see and shapes the layout from it; changeable later from Layout in the sidebar. */
function LayoutStep() {
  const { preferences, updatePreference } = usePreferences();
  const panels = preferences.panels;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 id="alpha-notice-title" className="text-[20px] font-semibold">
          What do you want on your screen?
        </h2>
        <p className="mt-1 text-[13px] text-app-muted">Pick a starting point. You can change it anytime from Layout in the sidebar.</p>
      </div>
      <div className="flex flex-col gap-2">
        {layoutPresets.map((preset) => {
          const active = samePanels(preset.panels, panels);
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              onClick={() => updatePreference("panels", preset.panels)}
              className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                active ? "border-app-accent bg-app-accent/10" : "border-app-hairline hover:bg-app-chip"
              }`}
            >
              <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border ${active ? "border-app-accent bg-app-accent text-app-on-accent" : "border-app-hairline-strong"}`}>
                {active && <Check className="size-3" />}
              </span>
              <span>
                <span className="block text-[14px] font-semibold text-app-ink">{preset.name}</span>
                <span className="block text-[12px] leading-snug text-app-muted">{preset.description}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5 pt-1" aria-label="Panels">
        {(Object.keys(panelNames) as Array<keyof TerminalPanels>).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={panels[key]}
            onClick={() => updatePreference("panels", { ...panels, [key]: !panels[key] })}
            className={`h-8 rounded-full border px-3 text-[12px] font-semibold transition-colors ${
              panels[key] ? "border-app-ink bg-app-chip text-app-ink" : "border-app-hairline text-app-faint hover:text-app-ink"
            }`}
          >
            {panelNames[key]}
          </button>
        ))}
      </div>
    </div>
  );
}

function AlphaStep() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="inline-flex size-10 items-center justify-center rounded-xl bg-[#fbefd6] text-[#87500a]">
          <FlaskConical className="size-5" aria-hidden />
        </span>
        <h2 id="alpha-notice-title" className="text-[18px] font-semibold">
          One last thing
        </h2>
      </div>
      <ul className="flex flex-col gap-2.5">
        {points.map((point) => (
          <li key={point} className="flex gap-2.5 text-[14px] leading-snug text-app-ink/90">
            <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[#f5a524]" />
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

const STEPS = 4;

/**
 * First-visit onboarding: welcome, pick a look, pick a layout, a short alpha notice. Shown once per browser; "Start trading" on
 * the last step stores the acknowledgement. No skip: the layout step is what keeps the first screen simple.
 */
export function AlphaNotice() {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isLast = step === STEPS - 1;

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

  const finish = () => {
    try {
      localStorage.setItem(ACK_KEY, "1");
    } catch {}
    setIsOpen(false);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="alpha-notice-title"
      // Escape is ignored: onboarding finishes with its own button.
      onCancel={(event) => event.preventDefault()}
      className="surface-menu m-auto max-h-[calc(100dvh-2rem)] w-[min(480px,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-3xl border border-app-card/70 bg-app-dialog p-0 font-sans text-app-ink shadow-[0_30px_80px_-20px_rgba(3,12,21,0.6)] backdrop:bg-[#030c15]/70 backdrop:backdrop-blur-[3px]"
    >
      <div className="flex flex-col gap-5 p-6">
        {step === 0 ? <WelcomeStep /> : step === 1 ? <LookStep /> : step === 2 ? <LayoutStep /> : <AlphaStep />}
        <div className="flex items-center gap-3">
          <div aria-label={`Step ${step + 1} of ${STEPS}`} className="flex gap-1.5">
            {Array.from({ length: STEPS }, (_, index) => (
              <span key={index} className={`h-1.5 rounded-full transition-all ${index === step ? "w-5 bg-app-ink" : "w-1.5 bg-app-hairline-strong"}`} />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
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
              onClick={isLast ? finish : () => setStep(step + 1)}
              autoFocus
              className="h-10 rounded-xl bg-app-accent px-5 text-[14px] font-semibold text-app-on-accent transition-colors hover:bg-app-accent/85"
            >
              {step === 0 ? "Get started" : isLast ? "Start trading" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
